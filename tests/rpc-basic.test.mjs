/**
 * vpnAgentRpc 基础行为测试（快速用例）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeWebSocket, sockets, sleep } from './fake-websocket.mjs'

globalThis.WebSocket = FakeWebSocket

const { VpnAgentRpc } = await import('../src/renderer/utils/vpnAgentRpc.ts')

function makeRpc() {
  const rpc = new VpnAgentRpc()
  let openCount = 0
  rpc.onOpen(() => { openCount++ })
  rpc.connectToServer('ws://127.0.0.1:17210/rpc')
  return { rpc, openCount: () => openCount }
}

const currentSocket = () => sockets[sockets.length - 1]

test('连接建立后可发送 JSON-RPC 请求并收到 result', async () => {
  const { rpc, openCount } = makeRpc()
  await sleep(20)

  assert.equal(openCount(), 1, '应触发 onOpen 回调')
  assert.equal(rpc.isConnected(), true, '连接状态应为已连接')

  let received = null
  rpc.callAsync('status', 0, (res) => { received = res })

  const ws = currentSocket()
  const req = JSON.parse(ws.sent[0])
  assert.equal(req.jsonrpc, '2.0')
  assert.equal(req.method, 'status')
  assert.equal(req.id, 0)

  ws.__message(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { ip: '10.0.0.1' } }))

  assert.ok(received, '回调应被调用')
  assert.deepEqual(received.result, { ip: '10.0.0.1' })
})

test('同一 id 再次请求时新回调覆盖旧回调（避免回调串台）', async () => {
  const { rpc } = makeRpc()
  await sleep(20)

  const calls = []
  rpc.callAsync('status', 0, () => { calls.push('cb1') })
  rpc.callAsync('status', 0, () => { calls.push('cb2') })

  const ws = currentSocket()
  ws.__message(JSON.stringify({ jsonrpc: '2.0', id: 0, result: {} }))

  assert.deepEqual(calls, ['cb2'], '只有最新回调应被调用，旧回调不应残留')
})

test('RPC 通道开启无限重连，agent 重启后不会永久失联', async () => {
  const { rpc } = makeRpc()
  await sleep(20)

  // 该 bug：setInfiniteReconnect(true) 从未被调用，默认只重连 5 次后彻底放弃
  assert.equal(
    rpc.websocket.infiniteReconnect,
    true,
    'RPC 通道必须开启无限重连，否则重连次数耗尽后客户端永久失联',
  )
})

test('主动断开（disconnect）后不再自动重连', async () => {
  const { rpc } = makeRpc()
  await sleep(20)

  const before = sockets.length
  rpc.websocket.disconnect() // 模拟用户主动断开
  await sleep(300)

  assert.equal(sockets.length, before, '主动断开后不应再创建新连接')
  assert.equal(rpc.isConnected(), false)
})
