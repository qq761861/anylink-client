/**
 * WebSocket 重连行为测试（快速用例）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeWebSocket, sockets, sleep } from './fake-websocket.mjs'

globalThis.WebSocket = FakeWebSocket

const { VpnAgentRpc } = await import('../src/renderer/utils/vpnAgentRpc.ts')

test('连接中异常断开后能自动重连并恢复可用', async () => {
  const rpc = new VpnAgentRpc()
  rpc.connectToServer('ws://127.0.0.1:17210/rpc')
  await sleep(20)

  const wsClient = rpc.websocket
  wsClient.setReconnectInterval(50)
  wsClient.setUseExponentialBackoff(false)

  const before = sockets.length
  sockets[sockets.length - 1].__close() // 模拟 agent 崩溃导致的异常断开
  assert.equal(rpc.isConnected(), false, '断开后应处于未连接状态')

  await sleep(300)
  assert.equal(sockets.length, before + 1, '应自动建立新连接')
  assert.equal(rpc.isConnected(), true, '重连后应恢复可用')
})

test('agent 长时间不可用时，重连不受 5 次上限限制（无限重连）', async () => {
  // 模拟每次尝试都连不上（连接停在 CONNECTING，不触发 open）
  FakeWebSocket.autoOpen = false
  try {
    const rpc = new VpnAgentRpc()
    rpc.connectToServer('ws://127.0.0.1:17210/rpc')
    await sleep(20)

    const wsClient = rpc.websocket
    wsClient.setReconnectInterval(50)
    wsClient.setUseExponentialBackoff(false)

    const before = sockets.length
    // 连续让 7 次尝试都失败
    for (let i = 0; i < 7; i++) {
      sockets[sockets.length - 1].__close()
      await sleep(150)
    }

    const created = sockets.length - before
    assert.ok(
      created >= 6,
      `agent 长时间不可用时应持续重试，实际仅新建 ${created} 个连接（默认上限 5 次会永久放弃）`,
    )
    assert.ok(
      wsClient.getReconnectAttempts() > 5,
      `重连次数应突破默认 5 次上限，实际 ${wsClient.getReconnectAttempts()} 次`,
    )
  } finally {
    FakeWebSocket.autoOpen = true
  }
})
