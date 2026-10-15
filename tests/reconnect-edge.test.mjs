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

  const controller = new ReconnectController(
    {
      connect: (mode, otp, seq) => events.push({ type: 'connect', mode, otp, seq, at: env.now(), done: false }),
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
