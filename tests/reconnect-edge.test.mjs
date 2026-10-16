/**
 * 断网重连边界场景测试（虚拟时钟）
 *
 * 覆盖：网络反复抖动时的总窗口、重连中主动断开、清理流程中主动断开、
 * OTP 保留、看门狗与正常结果的竞态等易出问题的边界
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { ReconnectController } = await import('../src/renderer/utils/reconnectController.ts')

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
  // active 核实结果的返回模式：'null'（无法判断）/ true / false / 'pending'（挂起由测试手动响应）
  let activeMode = 'null'
  const pendingActiveChecks = []

  const controller = new ReconnectController(
    {
      connect: (mode, otp, seq) => events.push({ type: 'connect', mode, otp, seq, at: env.now(), done: false }),
      cleanup: () => events.push({ type: 'cleanup', at: env.now() }),
      isOnline: () => online,
      checkActive: (cb) => {
        if (activeMode === 'pending') {
          pendingActiveChecks.push(cb)
          return
        }
        cb(activeMode === 'null' ? null : activeMode)
      },
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
    setActiveMode: (v) => { activeMode = v },
    respondActive: (v) => {
      const cb = pendingActiveChecks.pop()
      if (cb) cb(v)
    },
    connected: () => controller.markConnected(),
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

test('网络反复抖动时，10 分钟总窗口不会被重置（防止无限重连）', () => {
  const h = harness()
  h.connected()
  h.setOnline(false)
  h.controller.notifyNetworkOffline()

  let guard = 0
  let sinceFlap = 0
  while (h.notifications.length === 0 && guard++ < 3000) {
    h.failLastAttempt()
    if (h.notifications.length) break
    h.env.advance(1000)
    sinceFlap += 1000
    // 每 30 秒模拟一次网络抖动（恢复又断开）
    if (sinceFlap >= 30000) {
      sinceFlap = 0
      h.setOnline(true)
      h.controller.notifyNetworkOnline()
      h.setOnline(false)
    }
  }

  assert.ok(
    h.notifications.some((n) => n.message.includes('10 分钟')),
    '应最终停止并提示'
  )
  assert.ok(
    h.env.now() <= 10 * 60 * 1000 + 20000,
    `总重连时长应受 10 分钟窗口约束，实际 ${h.env.now()}ms`
  )
})

test('自动重连过程中用户主动断开，立即停止且不再发起连接', () => {
  const h = harness()
  h.connected()
  h.controller.notifyDropped('test')
  h.env.advance(1000)
  assert.equal(h.events.length, 1, '已进入重连流程')

  h.controller.markManualDisconnect()

  const before = h.events.length
  h.env.advance(120000)
  assert.equal(h.events.length, before, '主动断开后不应再发起任何重连')
  assert.equal(h.state.reconnecting, false)
  assert.equal(h.state.connecting, false)
})

test('清理残留流程中用户主动断开，立即停止清理重试', () => {
  const h = harness()
  h.connected()
  h.setOnline(true)
  h.controller.notifyDropped('test')
  h.env.advance(1000)
  h.controller.notifyConnectResult('Cannot create a file already exists.', h.events[0].seq)
  assert.equal(h.events[1].type, 'cleanup', '已进入清理流程')

  h.controller.markManualDisconnect()

  const before = h.events.length
  h.env.advance(120000)
  assert.equal(h.events.length, before, '清理流程中主动断开应停止重试')
})

test('自动重连时保留原 OTP（避免开启二次认证后重连失败）', () => {
  const h = harness()
  h.connected()

  // 首次手动连接带 OTP
  h.controller.beginAttempt('connect', '123456')
  const otpUsed = h.events[0].otp
  assert.equal(otpUsed, '123456', '手动连接应带上 OTP')

  // 掉线进入自动重连
  h.controller.notifyDropped('test')
  h.env.advance(1000)

  const retry = h.lastConnect()
  assert.equal(retry.otp, '123456', '自动重连必须复用原 OTP，否则带 OTP 的账号永远连不上')
})

test('结果在看门狗触发前返回时，不会重复调度', () => {
  const h = harness()
  h.connected()
  h.setOnline(false)
  h.controller.notifyNetworkOffline()
  h.env.advance(3000) // 首次尝试（网络不可用，看门狗 10s）
  assert.equal(h.events.length, 1)

  h.env.advance(9000) // 尚未到 10 秒
  h.controller.notifyConnectResult('network unreachable', h.events[0].seq) // 结果先到

  h.env.advance(3000)
  assert.equal(h.events.length, 2, '结果到达后只应调度一次重试，不应与看门狗重复触发')
})

test('destroy 后停止一切调度（组件卸载不泄漏定时器）', () => {
  const h = harness()
  h.connected()
  h.controller.notifyDropped('test')
  h.env.advance(1000)
  assert.equal(h.events.length, 1)

  h.controller.destroy()

  const before = h.events.length
  h.env.advance(300000)
  assert.equal(h.events.length, before, 'destroy 后不应再有任何调度')
})

// ===== 间歇性重连失效修复：active 核实机制 =====

test('休眠唤醒/IP 切换场景：网络恢复但已连接标记未变时，向 agent 核实发现隧道已死并立即重连', () => {
  const h = harness()
  h.connected() // 已连接状态（如睡眠唤醒后，系统未触发 offline 事件）
  h.setOnline(true)
  h.setActiveMode(false) // agent 报告：没有活跃连接（隧道实际已死）

  h.controller.notifyNetworkOnline()

  assert.equal(h.state.reconnecting, true, '核实发现隧道已死应立即进入重连')
  assert.equal(h.state.vpnConnected, false)

  h.env.advance(1000)
  assert.equal(h.events.length, 1, '应立即发起首次重连')
})

test('核实发现连接仍有效时，状态保持不变、不触发重连', () => {
  const h = harness()
  h.connected()
  h.setOnline(true)
  h.setActiveMode(true) // agent 报告：连接还活着

  h.controller.notifyNetworkOnline()

  assert.equal(h.state.vpnConnected, true, '连接有效应保持已连接')
  assert.equal(h.state.reconnecting, false, '不应触发重连')
  h.env.advance(60000)
  assert.equal(h.events.length, 0, '不应发起任何连接请求')
})

test('自动重连失败但 agent 实际已连上时，按成功处理并停止重连（防止死循环）', () => {
  const h = harness()
  h.connected()
  h.setActiveMode(true) // 核实结果：agent 已有活跃连接

  h.controller.notifyDropped('test')
  h.env.advance(1000)
  // 这次尝试的结果迟到了/被放弃，重试的 connect 被 agent 以"已在连接中"拒绝
  h.failLastAttempt('connect failed: session exists')

  assert.equal(h.state.vpnConnected, true, '核实到已连接应按成功处理')
  assert.equal(h.state.reconnecting, false, '应停止重连，避免死循环')

  const before = h.events.length
  h.env.advance(60000)
  assert.equal(h.events.length, before, '停止后不应继续发起连接')
})

test('自动重连失败且 agent 无连接时，核实后正常进入下一次调度', () => {
  const h = harness()
  h.connected()
  h.setActiveMode(false)

  h.controller.notifyDropped('test')
  h.env.advance(1000)
  h.failLastAttempt('network unreachable')

  h.env.advance(2000)
  assert.equal(h.events.length, 2, '核实无连接后应继续下一次重连')
})

test('checkActive 无响应时按无法判断处理，5 秒超时后回退到常规调度', () => {
  const h = harness()
  h.connected()
  h.setActiveMode('pending') // 核实请求挂起不响应

  h.controller.notifyDropped('test')
  h.env.advance(1000)
  h.failLastAttempt('network unreachable')

  // 核实挂起期间不应调度（防重入）
  assert.equal(h.events.length, 1)

  h.env.advance(5000) // 核实超时
  h.env.advance(2000)
  assert.equal(h.events.length, 2, '核实超时后应回退到常规重连调度')
})

test('无法判断（null）时按现状继续，不误触发重连', () => {
  const h = harness()
  h.connected()
  h.setOnline(true)
  h.setActiveMode(null)

  h.controller.notifyNetworkOnline()

  assert.equal(h.state.vpnConnected, true, '无法判断时应保持现状')
  assert.equal(h.state.reconnecting, false)
})
