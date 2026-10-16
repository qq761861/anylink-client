/**
 * 请求重叠测试（核心回归用例）
 *
 * 背景 bug：连接成功后约 30 秒莫名断开又自动连上。
 * 原因是 agent 在 DTLS 握手期间响应变慢，5 秒轮询出现请求重叠，
 * 旧请求的 30s 超时定时器未被清除，在 T≈30s 用假 "request timeout"
 * 误触发了后续请求的回调，被误判为 VPN 掉线。
 *
 * 修复：callAsyncParams 注册新定时器前先清除同 id 的旧定时器。
 * （耗时约 34s，单独文件以便并行执行）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeWebSocket, sockets, sleep } from './fake-websocket.mjs'

globalThis.WebSocket = FakeWebSocket

const { VpnAgentRpc } = await import('../src/renderer/utils/vpnAgentRpc.ts')

test('请求重叠时旧超时定时器不残留，不会误触发后续回调（假掉线回归）', async () => {
  const rpc = new VpnAgentRpc()
  rpc.connectToServer('ws://127.0.0.1:17210/rpc')
  await sleep(20)
  const ws = sockets[sockets.length - 1]

  const calls = []

  // T0：第一个 status 请求（模拟轮询）
  rpc.callAsync('status', 0, (res) => {
    calls.push({ tag: 'A', error: res.error ? res.error.message : null })
  })

  // T5s：第二个请求发出（此时第一个响应还没回来，形成重叠）
  await sleep(5000)
  rpc.callAsync('status', 0, (res) => {
    calls.push({ tag: 'B', error: res.error ? res.error.message : null })
  })

  // T6s：第一个请求的响应才回来（会命中当前回调）
  await sleep(1000)
  ws.__message(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { ok: true } }))

  // T20s：第三个请求发出并保持 pending（回调留在 map 中）
  await sleep(14000)
  rpc.callAsync('status', 0, (res) => {
    calls.push({ tag: 'C', error: res.error ? res.error.message : null })
  })

  // 等待跨过第一个请求的 30s 超时时刻（T≈30s）
  await sleep(11000)

  // 修复前：旧定时器在此刻用假 timeout 误触发 C 的回调
  // 修复后：不应有任何假超时回调
  assert.equal(calls.length, 1, `不应出现假超时回调，实际回调：${JSON.stringify(calls)}`)
  assert.equal(calls[0].tag, 'B', '只有第一个响应应命中当前回调 B')

  // 再确认 C 的回调仍然健康：正常响应后能拿到结果
  ws.__message(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { ok: 'C' } }))
  assert.equal(calls.length, 2)
  assert.equal(calls[1].tag, 'C')
  assert.equal(calls[1].error, null, 'C 的回调应收到正常结果而非假超时')
})
