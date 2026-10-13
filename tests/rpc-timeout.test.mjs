/**
 * 超时保护测试：agent 长时间不响应时，请求回调必须被超时错误唤醒，避免调用方永久卡死
 * （耗时约 31s，单独文件以便与其它用例并行执行）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeWebSocket, sockets, sleep } from './fake-websocket.mjs'

globalThis.WebSocket = FakeWebSocket

const { VpnAgentRpc } = await import('../src/renderer/utils/vpnAgentRpc.ts')

test('agent 不响应时，30s 超时保护会回调错误（避免 isConnecting 永久卡死）', async () => {
  const rpc = new VpnAgentRpc()
  rpc.connectToServer('ws://127.0.0.1:17210/rpc')
  await sleep(20)
  const ws = sockets[sockets.length - 1]

  let result = null
  rpc.callAsync('stat', 7, (res) => { result = res })

  // 前 29 秒内不应被误触发
  await sleep(29000)
  assert.equal(result, null, '29 秒内不应触发超时回调')

  await sleep(2500)
  assert.ok(result, '超过 30 秒后应触发超时回调')
  assert.ok(result.error, '超时回调应带 error 字段')
  assert.equal(result.error.message, 'request timeout')
})
