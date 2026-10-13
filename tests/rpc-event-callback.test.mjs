/**
 * 事件回调保护测试
 *
 * 背景 bug：该 RPC 协议中请求 id 与事件回调 id 共用 callbackMap
 * （DISCONNECT=3、ABORT=6）。disconnect 请求复用 id=3 且不传回调，
 * 旧实现仍会为 id=3 注册 30s 超时定时器，30 秒后用假 timeout 错误
 * 误触发 registerCallback 注册的 DISCONNECT 事件回调 → 误判断线。
 *
 * 修复：超时保护仅在调用方提供回调时启用。
 * （耗时约 32s，单独文件以便并行执行）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeWebSocket, sockets, sleep } from './fake-websocket.mjs'

globalThis.WebSocket = FakeWebSocket

const { VpnAgentRpc } = await import('../src/renderer/utils/vpnAgentRpc.ts')

test('disconnect 请求（无回调）不会用假超时误触发 DISCONNECT 事件回调', async () => {
  const rpc = new VpnAgentRpc()
  rpc.connectToServer('ws://127.0.0.1:17210/rpc')
  await sleep(20)
  const ws = sockets[sockets.length - 1]

  // 注册 agent 主动推送的 DISCONNECT 事件回调（id=3）
  let eventCalled = 0
  rpc.registerCallback(3, () => { eventCalled++ })

  // 发起 disconnect 请求，复用 id=3 且不传回调
  rpc.callAsync('disconnect', 3)

  // 等待跨过 30s 超时时刻
  await sleep(31500)

  assert.equal(eventCalled, 0, 'DISCONNECT 事件回调不应被伪超时误触发')

  // 事件回调仍然有效：agent 主动推送时能正常收到
  ws.__message(JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} }))
  assert.equal(eventCalled, 1, 'agent 主动推送的 DISCONNECT 事件应能正常触发回调')
})
