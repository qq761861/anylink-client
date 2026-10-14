/**
 * VPN 断线自动重连状态机（纯逻辑，不依赖 Vue / Electron，可单元测试）
 *
 * 视图层职责：调用下方入口方法 + 执行具体 RPC 动作 + 展示 hooks.onUpdate 推送的状态。
 * 定时器、当前时间、网络状态、连接动作全部通过注入传入，便于用虚拟时钟做确定性测试。
 *
 * 修复要点（对应断网重连不生效的根因）：
 *  - 系统网络不可用时立即判定掉线，不再等轮询连续失败（原要等 agent DPD 超时，几十秒）
 *  - 网络恢复时不被"正在连接中"状态阻塞，放弃挂起尝试立即重连
 *  - 单次尝试加看门狗：断网时 10s 判定失败（原要等满 RPC 30s 超时）
 *  - 手动断开后再次手动连接即解除抑制标记，避免掉线信号被永久忽略
 */

export type ConnectMode = 'reconnect' | 'connect'
export type NotifyLevel = 'error' | 'warning' | 'info' | 'success'

export interface ReconnectState {
  connecting: boolean
  reconnecting: boolean
  /** VPN 连接状态由控制器统一维护，视图通过 onUpdate 同步，
   *  避免"轮询失败判定掉线"路径上视图无法及时置位导致状态不一致 */
  vpnConnected: boolean
}

export interface ReconnectHooks {
  /** 发起连接动作（seq 用于在途结果校验） */
  connect: (mode: ConnectMode, otp: string, seq: number) => void
  /** 通知 agent 清理残留连接（disconnect） */
  cleanup: () => void
  /** 系统网络是否可用 */
  isOnline: () => boolean
  /** UI 状态同步 */
  onUpdate: (state: ReconnectState) => void
  /** 提示信息 */
  notify?: (level: NotifyLevel, message: string) => void
  /** 日志 */
  log?: (...args: unknown[]) => void
}

export interface ReconnectEnv {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  now: () => number
}

export interface ReconnectOptions {
  /** 首次重连等待 */
  baseDelay: number
  /** 退避封顶 */
  maxDelay: number
  /** 总重连时长上限 */
  timeout: number
  /** 单次尝试看门狗检查间隔，断网时按此粒度快速判定失败 */
  attemptTimeout: number
  /** 残留连接清理重试的递增等待时间 */
  cleanRetryDelays: number[]
  /** 轮询连续失败多少次才判定掉线（防抖） */
  pollFailThreshold: number
}

export const DEFAULT_RECONNECT_OPTIONS: ReconnectOptions = {
  baseDelay: 1000,
  maxDelay: 3000,
  timeout: 10 * 60 * 1000,
  attemptTimeout: 10000,
  cleanRetryDelays: [3000, 8000, 15000, 30000],
  pollFailThreshold: 3
}

/** 识别 Windows ERROR_ALREADY_EXISTS 类错误（残留虚拟网卡/会话未清理） */
export function isAdapterExistsError(errMsg: string): boolean {
  return typeof errMsg === 'string' && errMsg.toLowerCase().includes('already exists')
}

export class ReconnectController {
  private hooks: ReconnectHooks
  private env: ReconnectEnv
  private opts: ReconnectOptions

  /** 用户主动断开中：抑制一切自动重连 */
  private activeDisconnect = false
  /** 断线前是否处于已连接状态（决定网络恢复后是否需要重连） */
  private wasConnected = false
  private networkLost = false

  private connecting = false
  private reconnecting = false
  /** VPN 是否已连接（控制器统一维护，避免与视图状态不同步） */
  private vpnConnected = false

  private timer: unknown = null
  private cleanTimer: unknown = null
  private attemptWatch: unknown = null

  private attempt = 0
  private startTime = 0
  private seq = 0
  /** 已发起但尚未收到结果的尝试序号 */
  private pendingSeq: number | null = null
  private attemptStartedAt = 0
  private lastOtp = ''

  private cleanRetryCount = 0
  private cleaningUpStale = false
  private pollFailCount = 0
  private stopped = false

  constructor(hooks: ReconnectHooks, env: ReconnectEnv, options?: Partial<ReconnectOptions>) {
    this.hooks = hooks
    this.env = env
    this.opts = { ...DEFAULT_RECONNECT_OPTIONS, ...(options || {}) }
  }

  // ===== 查询 =====
  isConnecting(): boolean { return this.connecting }
  isReconnecting(): boolean { return this.reconnecting }
  isActiveDisconnect(): boolean { return this.activeDisconnect }
  isCleaning(): boolean { return this.cleaningUpStale }
  getAttempt(): number { return this.attempt }

  // ===== 生命周期入口 =====

  /** 连接成功：复位全部状态 */
  markConnected(): void {
    this.log('连接成功，复位重连状态')
    this.pollFailCount = 0
    this.attempt = 0
    this.startTime = 0
    this.cleanRetryCount = 0
    this.cleaningUpStale = false
    this.wasConnected = true
    this.activeDisconnect = false
    this.vpnConnected = true
    this.stopAll()
  }

  /** 用户主动断开：停止一切自动重连 */
  markManualDisconnect(): void {
    this.activeDisconnect = true
    this.wasConnected = false
    this.networkLost = false
    this.pollFailCount = 0
    this.cleanRetryCount = 0
    this.cleaningUpStale = false
    this.vpnConnected = false
    this.stopAll()
  }

  /** 用户主动发起连接：解除主动断开抑制（修复：此前该标记只能靠连接成功复位，
   *  导致"手动断开 → 再次手动连接失败"后掉线信号被永久忽略，完全不重连） */
  markManualConnectStart(): void {
    this.activeDisconnect = false
  }

  /** 掉线信号统一入口（ABORT/DISCONNECT/轮询失败/网络不可用） */
  notifyDropped(reason: string): void {
    if (this.activeDisconnect || this.stopped) return
    this.log('收到掉线信号：', reason)
    this.wasConnected = true
    this.vpnConnected = false
    this.emit()
    this.scheduleReconnect()
  }

  /** stat/status 轮询失败（防抖计数） */
  notifyPollFailure(): void {
    if (this.activeDisconnect || this.stopped) return
    if (!this.vpnConnected) return
    this.pollFailCount++
    if (this.pollFailCount >= this.opts.pollFailThreshold) {
      this.pollFailCount = 0
      this.notifyDropped('poll')
    }
  }

  /** stat/status 轮询成功：复位失败计数 */
  notifyPollSuccess(): void {
    this.pollFailCount = 0
  }

  /** 系统网络恢复 */
  notifyNetworkOnline(): void {
    this.networkLost = false
    if (this.stopped) return
    if (!this.wasConnected || this.activeDisconnect) return
    if (this.vpnConnected) return

    // 关键修复：不再被 connecting 阻塞。若当前有挂起的尝试（agent 卡在握手），
    // 直接放弃等待进入重连，避免"网络已恢复但要等挂起请求超时"的长时间空等
    this.abandonPendingAttempt()
    this.clearTimer(this.timer)
    this.timer = null
    // 用最小延迟立即重试；保留已尝试次数，避免又从"快速重连"开始
    // （断网较久后服务端 session 已失效，快速重连必然失败，应直接完整重连）
    this.log('系统网络已恢复，立即重连')
    this.scheduleReconnect(this.opts.baseDelay)
  }

  /** 系统网络丢失 */
  notifyNetworkOffline(): void {
    this.networkLost = true
    if (this.stopped) return
    // 关键修复：系统网络不可用即视为 VPN 已断，立即进入重连。
    // 原实现只依赖 stat/status 连续失败，而 agent 要等 DPD 超时（数十秒）才会报错
    if (this.wasConnected && !this.activeDisconnect && this.vpnConnected) {
      this.notifyDropped('network-offline')
    }
  }

  /** 开始一次连接尝试，返回序号（视图回调时需带回，用于忽略迟到结果） */
  beginAttempt(mode: ConnectMode, otp = ''): number {
    this.lastOtp = otp
    return this.startAttempt(mode)
  }

  /** 连接结果回调：errMsg 为 null 表示成功 */
  notifyConnectResult(errMsg: string | null, seq: number): void {
    if (seq !== this.pendingSeq) {
      this.log('忽略迟到的连接结果 seq=', seq, '当前 pendingSeq=', this.pendingSeq)
      return
    }
    this.pendingSeq = null
    this.clearTimer(this.attemptWatch)
    this.attemptWatch = null
    this.setConnecting(false)

    if (!errMsg) {
      this.markConnected()
      return
    }
    if (isAdapterExistsError(errMsg)) {
      this.log('连接失败：残留虚拟网卡，进入清理重试', errMsg)
      this.startCleanup()
      return
    }
    if (this.reconnecting) {
      this.log('自动重连尝试失败，继续调度', errMsg)
      this.scheduleReconnect()
      return
    }
    this.hooks.notify?.('error', errMsg)
  }

  /** RPC 通道不可用（agent 可能正在重启） */
  notifyRpcUnavailable(): void {
    if (this.stopped) return
    if (this.cleaningUpStale) {
      this.startCleanup()
    } else if (this.reconnecting) {
      this.log('RPC 未连接，等待恢复后继续重连')
      this.scheduleReconnect()
    }
  }

  /** 组件销毁 */
  destroy(): void {
    this.stopped = true
    this.stopAll()
  }

  // ===== 内部实现 =====

  private startAttempt(mode: ConnectMode): number {
    this.clearTimer(this.attemptWatch)
    const seq = ++this.seq
    this.pendingSeq = seq
    this.attemptStartedAt = this.env.now()
    this.setConnecting(true)
    this.hooks.connect(mode, this.lastOtp, seq)
    this.armWatchdog(seq)
    return seq
  }

  /**
   * 单次尝试看门狗：
   *  - 网络不可用时按 attemptTimeout 粒度快速判定失败（不必等满 RPC 30s 超时）
   *  - 网络正常但服务器响应慢时，允许最长 3 倍等待（保持原 30s 上限的容错）
   */
  private armWatchdog(seq: number): void {
    this.clearTimer(this.attemptWatch)
    this.attemptWatch = this.env.setTimeout(() => {
      this.attemptWatch = null
      if (this.pendingSeq !== seq) return

      const waited = this.env.now() - this.attemptStartedAt
      const offline = !this.hooks.isOnline()
      if (offline || waited >= this.opts.attemptTimeout * 3) {
        this.log(`尝试 seq=${seq} 判定失败（等待 ${waited}ms，网络${offline ? '不可用' : '正常但超时'}）`)
        this.pendingSeq = null
        this.setConnecting(false)
        if (this.reconnecting) {
          this.scheduleReconnect()
        } else {
          this.hooks.notify?.(
            'error',
            offline ? '网络连接不可用，请检查网络后重试' : '连接超时，请检查服务器地址或网络后重试'
          )
        }
        return
      }
      this.armWatchdog(seq)
    }, this.opts.attemptTimeout)
  }

  /** 放弃当前挂起的尝试（其结果将被忽略） */
  private abandonPendingAttempt(): void {
    if (this.pendingSeq === null) return
    this.log('放弃挂起的尝试 seq=', this.pendingSeq)
    this.pendingSeq = null
    this.clearTimer(this.attemptWatch)
    this.attemptWatch = null
    this.setConnecting(false)
  }

  /**
   * 调度自动重连（10 分钟内持续，指数退避，网络恢复后快速重试）
   * @param forceDelay 指定等待时间（网络恢复时用最小延迟立即重试）
   */
  private scheduleReconnect(forceDelay?: number): void {
    if (this.timer) return
    if (this.stopped || this.activeDisconnect) return
    if (this.cleaningUpStale) return

    if (this.startTime === 0) this.startTime = this.env.now()
    if (this.env.now() - this.startTime >= this.opts.timeout) {
      this.log(`重连已超过 ${Math.round(this.opts.timeout / 60000)} 分钟，停止自动重连`)
      this.stopAll()
      this.hooks.notify?.(
        'warning',
        `网络连接失败，已持续重连 ${Math.round(this.opts.timeout / 60000)} 分钟，请检查网络后手动重试`
      )
      return
    }

    // navigator.onLine 可能不准，每次调度前用其做二次校正
    if (this.hooks.isOnline()) this.networkLost = false

    let delay =
      forceDelay !== undefined
        ? forceDelay
        : Math.min(this.opts.baseDelay * Math.pow(2, this.attempt), this.opts.maxDelay)
    if (forceDelay === undefined && this.networkLost) delay = this.opts.maxDelay

    this.attempt++
    this.reconnecting = true
    this.setConnecting(true)
    this.log(`第 ${this.attempt} 次重连，延迟 ${delay}ms，网络${this.networkLost ? '不可用' : '正常'}`)

    this.timer = this.env.setTimeout(() => {
      this.timer = null
      if (this.stopped || this.activeDisconnect) {
        this.setConnecting(false)
        return
      }
      // 第一次尝试快速重连（reconnect），失败后降级为完整重连（connect）：
      // 断网稍久服务端会清理 session，reconnect 无法恢复，必须重新 connect
      const mode: ConnectMode = this.attempt <= 1 ? 'reconnect' : 'connect'
      this.startAttempt(mode)
    }, delay)
  }

  /** 残留连接清理重试：先 disconnect 让 agent 清理，再完整重连，等待递增 */
  private startCleanup(): void {
    if (this.cleanRetryCount >= this.opts.cleanRetryDelays.length) {
      this.cleaningUpStale = false
      this.cleanRetryCount = 0
      if (this.reconnecting) {
        // 自动重连流程中：提示用户残留问题，同时转回常规退避继续重试
        this.hooks.notify?.(
          'warning',
          '自动清理残留虚拟网卡未成功，仍在持续重试；若长时间无法连接，请重启软件或电脑'
        )
        this.scheduleReconnect()
      } else {
        this.setConnecting(false)
        this.hooks.notify?.(
          'error',
          '连接失败：检测到残留虚拟网卡且自动清理无效，请点击断开后重试，或重启软件/电脑后重试'
        )
      }
      return
    }

    const delay = this.opts.cleanRetryDelays[this.cleanRetryCount]
    this.cleaningUpStale = true
    this.cleanRetryCount++
    this.setConnecting(true)
    this.log(`清理残留连接后重试 (${this.cleanRetryCount}/${this.opts.cleanRetryDelays.length})，等待 ${delay}ms`)
    this.hooks.cleanup()

    this.clearTimer(this.cleanTimer)
    this.cleanTimer = this.env.setTimeout(() => {
      this.cleanTimer = null
      this.cleaningUpStale = false
      if (this.stopped || this.activeDisconnect) {
        this.setConnecting(false)
        return
      }
      this.startAttempt('connect')
    }, delay)
  }

  /** 停止一切调度与在途尝试 */
  private stopAll(): void {
    this.clearTimer(this.timer); this.timer = null
    this.clearTimer(this.cleanTimer); this.cleanTimer = null
    this.clearTimer(this.attemptWatch); this.attemptWatch = null
    this.reconnecting = false
    this.pendingSeq = null
    this.seq++ // 让在途结果失效
    this.setConnecting(false)
  }

  private emit(): void {
    this.hooks.onUpdate({
      connecting: this.connecting,
      reconnecting: this.reconnecting,
      vpnConnected: this.vpnConnected
    })
  }

  private setConnecting(v: boolean): void {
    this.connecting = v
    this.emit()
  }

  private clearTimer(id: unknown): void {
    if (id !== null && id !== undefined) this.env.clearTimeout(id)
  }

  private log(...args: unknown[]): void {
    if (this.hooks.log) this.hooks.log(...args)
  }
}

export default ReconnectController
