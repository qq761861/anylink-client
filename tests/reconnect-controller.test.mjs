/**
 * 断网自动重连状态机测试（虚拟时钟，确定性执行）
 *
 * 覆盖：断网进入重连、退避调度、reconnect→connect 降级、网络恢复立即重连、
 * 单次尝试看门狗、10 分钟上限、主动断开抑制、轮询防抖、残留清理重试等场景
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { ReconnectController } = await import('../src/renderer/utils/reconnectController.ts')

/** 虚拟时钟调度器：advance(ms) 按时间顺序执行到期任务 */
function createEnv() {
  let now = 0
  let seq = 0
  const tasks = new Map()
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq
      tasks.set(id, { fn, at: now + ms })
      return id
    },
    clearTimeout: (id) => { tasks.delete(id) },
    advance(ms) {
      const target = now + ms
      for (;;) {
        let nextId = null
        let nextTask = null
        for (const [id, t] of tasks) {
          if (t.at <= target && (nextTask === null || t.at < nextTask.at)) {
            nextId = id
            nextTask = t
          }
        }
        if (nextId === null) break
        tasks.delete(nextId)
        now = Math.max(now, nextTask.at)
        nextTask.fn()
      }
      now = target
    }
  }
}

function harness(options) {
  const env = createEnv()
  const events = []
  const notifications = []
  const state = { connecting: false, reconnecting: false, vpnConnected: false }
  let online = true

  const controller = new ReconnectController(
    {
      connect: (mode, otp, seq) => events.push({ type: 'connect', mode, seq, at: env.now(), done: false }),
      cleanup: () => events.push({ type: 'cleanup', at: env.now() }),
      isOnline: () => online,
      onUpdate: (s) => {
        state.connecting = s.connecting
        state.reconnecting = s.reconnecting
        state.vpnConnected = s.vpnConnected
      },
      notify: (level, message) => notifications.push({ level, message, at: env.now() }),
      log: () => {}
    },
    env,
    options
  )

  return {
    env,
    events,
    notifications,
    state,
    controller,
    setOnline: (v) => { online = v },
    /** 建立"已连接"基线状态 */
    connected: () => {
      controller.markConnected()
    },
    failLastAttempt: (msg = 'network unreachable') => {
      const last = [...events].reverse().find((e) => e.type === 'connect' && !e.done)
      if (!last) return false
      last.done = true
      controller.notifyConnectResult(msg, last.seq)
      return true
    },
    lastConnect: () => [...events].reverse().find((e) => e.type === 'connect')
  }
}

test('网络断开后立刻进入重连状态（不等轮询连续失败），首次尝试按 3 秒间隔', () => {
  const h = harness()
  h.connected()

  h.setOnline(false)
  h.controller.notifyNetworkOffline()

  assert.equal(h.state.reconnecting, true, '断网后应立即进入重连状态')

  // 网络不可用期间用固定封顶间隔（3s）等待，避免无谓密集重试
  h.env.advance(3000)
  assert.equal(h.events.length, 1, '3 秒后应发起首次重连')
  assert.equal(h.events[0].mode, 'reconnect', '首次应使用快速重连')
})

test('VPN 掉线（网络正常）时按 1s/2s/3s 退避，首次快速重连后降级完整连接', () => {
  const h = harness()
  h.connected()

  h.controller.notifyDropped('test')

  h.env.advance(1000)
  assert.equal(h.events.length, 1, '1 秒后首次重连')
  assert.equal(h.events[0].mode, 'reconnect', '首次使用快速重连')

  h.failLastAttempt()
  h.env.advance(2000)
  assert.equal(h.events[1].mode, 'connect', '第二次降级为完整重连')

  const t2 = h.events[1].at
  h.failLastAttempt()
  h.env.advance(3000)
  assert.equal(h.events[2].mode, 'connect')
  assert.equal(h.events[2].at - t2, 3000, '退避递增到 3 秒')

  const t3 = h.events[2].at
  h.failLastAttempt()
  h.env.advance(3000)
  assert.equal(h.events[3].at - t3, 3000, '之后固定 3 秒（封顶）')
})

test('断网时单次尝试 10 秒即判定失败，不必等满 RPC 30 秒超时', () => {
  const h = harness()
  h.connected()

  h.setOnline(false)
  h.controller.notifyNetworkOffline()
  h.env.advance(3000)
  assert.equal(h.events.length, 1)

  const attemptAt = h.env.now()
  // 不返回结果（模拟 agent 卡在握手）
  h.env.advance(10000)
  h.env.advance(3000)
  assert.equal(h.events.length, 2, '应继续下一次重连')

  const gap = h.events[1].at - attemptAt
  assert.ok(gap <= 14000, `断网时单次尝试应在约 13 秒内判失败并重试，实际 ${gap}ms`)
})

test('网络正常但服务器响应慢时，不提前判定失败（保留 30 秒容错）', () => {
  const h = harness()
  h.connected()
  h.setOnline(true)

  h.controller.notifyDropped('test')
  h.env.advance(1000)
  assert.equal(h.events.length, 1)

  h.env.advance(10000)
  assert.equal(h.events.length, 1, '网络正常时不应提前判失败')
  h.env.advance(19000)
  assert.equal(h.events.length, 1, '未到 30 秒仍应等待')

  h.env.advance(1000) // 累计 30 秒，看门狗判定失败
  h.env.advance(2000) // 退避 2 秒后发起下一次
  assert.equal(h.events.length, 2, '超过 30 秒应放弃等待并发起重试')
})

test('网络恢复时立即重连，不被挂起的尝试阻塞', () => {
  const h = harness()
  h.connected()

  h.setOnline(false)
  h.controller.notifyNetworkOffline()
  h.env.advance(3000)
  assert.equal(h.events.length, 1, '已发起一次挂起的尝试（agent 卡住未返回）')

  // 网络恢复（此时上一次尝试仍未返回）
  h.setOnline(true)
  h.controller.notifyNetworkOnline()

  h.env.advance(1000)
  assert.equal(h.events.length, 2, '网络恢复后应在 1 秒内发起新重连，而不是等挂起请求超时')
})

test('超过 10 分钟未连上则停止并提示，状态复位', () => {
  const h = harness()
  h.connected()

  h.setOnline(false)
  h.controller.notifyNetworkOffline()

  let guard = 0
  while (h.notifications.length === 0 && guard++ < 3000) {
    h.failLastAttempt()
    if (h.notifications.length) break
    h.env.advance(1000)
  }

  assert.ok(
    h.notifications.some((n) => n.level === 'warning' && n.message.includes('10 分钟')),
    '超过 10 分钟应给出停止提示'
  )
  assert.equal(h.state.reconnecting, false, '应停止重连')
  assert.equal(h.state.connecting, false)
})

test('用户主动断开后不重连；再次手动连接后掉线仍能自动重连（抑制标记残留修复）', () => {
  const h = harness()
  h.connected()


  h.controller.markManualDisconnect()
  h.controller.notifyDropped('after-manual-disconnect')
  h.env.advance(60000)
  assert.equal(h.events.length, 0, '主动断开后不应发起任何重连')

  // 用户再次手动连接，且这次失败
  h.controller.markManualConnectStart()
  const seq = h.controller.beginAttempt('connect', '')
  h.controller.notifyConnectResult('auth failed', seq)
  assert.equal(h.events.length, 1, '手动连接请求已发出')

  // 此后掉线应能正常触发自动重连（修复前 activeDisconnect 残留会永久忽略掉线信号）
  h.controller.notifyDropped('drop-after-manual')
  h.env.advance(1000)
  assert.equal(h.events.length, 2, '手动连接失败后掉线仍应自动重连')
})

test('轮询失败防抖：连续 3 次才判定掉线，中途成功即重置', () => {
  const h = harness()
  h.connected()

  h.controller.notifyPollFailure()
  h.controller.notifyPollFailure()
  assert.equal(h.state.reconnecting, false, '两次失败不应判定掉线')

  h.controller.notifyPollSuccess()
  h.controller.notifyPollFailure()
  h.controller.notifyPollFailure()
  assert.equal(h.state.reconnecting, false, '成功应重置失败计数')

  h.controller.notifyPollFailure()
  assert.equal(h.state.reconnecting, true, '连续三次失败应触发重连')
})

test('残留虚拟网卡（already exists）时先清理再按 3s/8s 递增等待重试', () => {
  const h = harness()
  h.connected()
  h.setOnline(true)

  h.controller.notifyDropped('test')
  h.env.advance(1000)
  const first = h.events[0]

  h.controller.notifyConnectResult('Cannot create a file when that file already exists.', first.seq)
  assert.equal(h.events[1].type, 'cleanup', '应先通知 agent 清理残留')

  h.env.advance(3000)
  assert.equal(h.events[2].type, 'connect', '3 秒后重试连接')

  h.controller.notifyConnectResult('Cannot create a file when that file already exists.', h.events[2].seq)
  assert.equal(h.events[3].type, 'cleanup')
  h.env.advance(8000)
  assert.equal(h.events[4].type, 'connect', '第二次清理后等待 8 秒重试')
})

test('清理重试耗尽后转回常规退避并提示用户（不再静默循环）', () => {
  const h = harness()
  h.connected()
  h.setOnline(true)

  h.controller.notifyDropped('test')
  h.env.advance(1000)
  h.controller.notifyConnectResult('Cannot create a file already exists.', h.events[0].seq)

  let guard = 0
  while (h.notifications.length === 0 && guard++ < 20) {
    h.env.advance(30000)
    const last = h.lastConnect()
    if (last && !last.done) {
      last.done = true
      h.controller.notifyConnectResult('Cannot create a file already exists.', last.seq)
    }
  }

  assert.ok(
    h.notifications.some((n) => n.message.includes('残留虚拟网卡')),
    '清理重试耗尽后应提示用户残留问题'
  )
  // 自动重连流程中不应停下，而是转回常规退避继续重试
  assert.equal(h.state.reconnecting, true, '应继续保持在重连流程中')
})

test('连接成功后复位全部重连状态', () => {
  const h = harness()
  h.connected()
  h.setOnline(false)
  h.controller.notifyNetworkOffline()
  h.env.advance(3000)
  assert.equal(h.state.reconnecting, true)


  h.controller.notifyConnectResult(null, h.events[0].seq)

  assert.equal(h.state.reconnecting, false)
  assert.equal(h.state.connecting, false)
  assert.equal(h.controller.getAttempt(), 0)

  const before = h.events.length
  h.env.advance(60000)
  assert.equal(h.events.length, before, '连接成功后不应继续重连')
})

test('看门狗判定失败后，迟到的连接结果被忽略', () => {
  const h = harness()
  h.connected()
  h.setOnline(false)
  h.controller.notifyNetworkOffline()
  h.env.advance(3000)

  const seq = h.events[0].seq
  h.env.advance(10000) // 看门狗判定本次尝试失败

  // 迟到的"成功"结果回来，不应打断重连流程
  h.controller.notifyConnectResult(null, seq)
  assert.equal(h.state.reconnecting, true, '迟到结果不应终止重连流程')

  h.env.advance(3000)
  assert.equal(h.events.length, 2, '应继续下一次重连')
})
