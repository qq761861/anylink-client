/**
 * 断网重连集成测试：真实的 VpnAgentRpc（假 WebSocket）+ 重连状态机
 *
 * 模拟"视图层"的接线方式，验证断网 → 自动重连 → 网络恢复后连上 的完整链路，
 * 覆盖 RPC 响应如何驱动状态机调度（单元测试之外的集成保障）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeWebSocket, sockets, sleep } from './fake-websocket.mjs'

globalThis.WebSocket = FakeWebSocket

const { VpnAgentRpc } = await import('../src/renderer/utils/vpnAgentRpc.ts')
const { ReconnectController } = await import('../src/renderer/utils/reconnectController.ts')

/** 虚拟时钟（供状态机使用，RPC 侧用真实定时器） */
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

test('断网后自动重连，网络恢复后连上并停止重连（集成链路）', async () => {
  const env = createEnv()
  let online = true
  const state = { connecting: false, reconnecting: false, vpnConnected: false }
  const sentRequests = []

  const rpc = new VpnAgentRpc()
  rpc.connectToServer('ws://127.0.0.1:17210/rpc')
  await sleep(20)
  const ws = sockets[sockets.length - 1]
  ws.send = (msg) => { sentRequests.push(JSON.parse(msg)) }

  const controller = new ReconnectController(
    {
      connect: (mode, otp, seq) => {
        const isReconnect = mode === 'reconnect'
        rpc.callAsyncParams(
          isReconnect ? 'reconnect' : 'connect',
          isReconnect ? 4 : 2,
          { host: 'vpn.test', username: 'u', password: 'p' },
          (data) => {
            const hasError = data.error && Object.keys(data.error).length !== 0
            controller.notifyConnectResult(hasError ? String(data.error.message || '') : null, seq)
          }
        )
      },
      cleanup: () => rpc.callAsync('disconnect', 3),
      checkActive: (cb) => cb(null),
      isOnline: () => online,
      onUpdate: (s) => { state.connecting = s.connecting; state.reconnecting = s.reconnecting; state.vpnConnected = s.vpnConnected },
      notify: () => {},
      log: () => {}
    },
    env
  )

  // 初始：已连接
  controller.markConnected()
  assert.equal(state.vpnConnected, true)

  // === 断网 ===
  online = false
  controller.notifyNetworkOffline()
  assert.equal(state.reconnecting, true, '断网后应立即进入重连')
  assert.equal(state.vpnConnected, false)

  // 3 秒后发起首次快速重连（reconnect，id=4）
  env.advance(3000)
  assert.equal(sentRequests.length, 1)
  assert.equal(sentRequests[0].method, 'reconnect')

  // agent 返回失败（服务器不可达）
  ws.__message(JSON.stringify({ jsonrpc: '2.0', id: 4, error: { code: -1, message: 'network unreachable' } }))

  // 网络仍不可用，按封顶间隔 3 秒后降级为完整重连（connect，id=2）
  env.advance(3000)
  assert.equal(sentRequests.length, 2)
  assert.equal(sentRequests[1].method, 'connect', '失败后应降级为完整重连')

  // agent 再次失败
  ws.__message(JSON.stringify({ jsonrpc: '2.0', id: 2, error: { code: -1, message: 'network unreachable' } }))

  // === 网络恢复 ===
  online = true
  controller.notifyNetworkOnline()
  env.advance(1000)
  assert.equal(sentRequests.length, 3, '网络恢复后应立即发起重连')

  // 这次连上了
  ws.__message(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { ok: true } }))

  assert.equal(state.vpnConnected, true, '连接成功应回到已连接状态')
  assert.equal(state.reconnecting, false, '连接成功后应停止重连')
  assert.equal(state.connecting, false)

  // 成功后不应再有新的连接请求
  env.advance(30000)
  assert.equal(sentRequests.length, 3, '连接成功后不应继续发起重连')
})

test('连接失败为 already exists 时，先发 disconnect 清理再重试（集成链路）', async () => {
  const env = createEnv()
  const state = { vpnConnected: false }
  const sentRequests = []

  const rpc = new VpnAgentRpc()
  rpc.connectToServer('ws://127.0.0.1:17210/rpc')
  await sleep(20)
  const ws = sockets[sockets.length - 1]
  ws.send = (msg) => { sentRequests.push(JSON.parse(msg)) }

  const controller = new ReconnectController(
    {
      connect: (mode, otp, seq) => {
        const isReconnect = mode === 'reconnect'
        rpc.callAsyncParams(
          isReconnect ? 'reconnect' : 'connect',
          isReconnect ? 4 : 2,
          {},
          (data) => {
            const hasError = data.error && Object.keys(data.error).length !== 0
            controller.notifyConnectResult(hasError ? String(data.error.message || '') : null, seq)
          }
        )
      },
      cleanup: () => {
        // 状态机要求清理：向 agent 发 disconnect（ws.send 已统一记录请求）
        rpc.callAsync('disconnect', 3)
      },
      checkActive: (cb) => cb(null),
      isOnline: () => true,
      onUpdate: (s) => { state.vpnConnected = s.vpnConnected },
      notify: () => {},
      log: () => {}
    },
    env
  )

  controller.markConnected()
  controller.notifyDropped('test')

  env.advance(1000)
  assert.equal(sentRequests[0].method, 'reconnect')

  // 返回残留虚拟网卡错误
  ws.__message(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      error: { code: -1, message: 'Cannot create a file when that file already exists.' }
    })
  )

  assert.equal(sentRequests[1].method, 'disconnect', '应先发 disconnect 清理残留')

  // 3 秒后重试（完整 connect）
  env.advance(3000)
  assert.equal(sentRequests[2].method, 'connect', '清理后应完整重连')

  ws.__message(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { ok: true } }))
  assert.equal(state.vpnConnected, true)
})
