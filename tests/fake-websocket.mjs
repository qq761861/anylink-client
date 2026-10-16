/**
 * 测试用假 WebSocket（零依赖）
 * 模拟浏览器 WebSocket 的最小行为，供 websocketClient / vpnAgentRpc 单元测试使用。
 */

export const sockets = []

export class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  // 是否自动异步打开，测试可置为 false 手动控制
  static autoOpen = true

  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    this.onopen = null
    this.onmessage = null
    this.onclose = null
    this.onerror = null
    this.sent = []
    sockets.push(this)

    if (FakeWebSocket.autoOpen) {
      setTimeout(() => {
        if (this.readyState === FakeWebSocket.CONNECTING) this.__open()
      }, 0)
    }
  }

  // 测试辅助：模拟服务端打开连接
  __open() {
    this.readyState = FakeWebSocket.OPEN
    if (this.onopen) this.onopen({ type: 'open' })
  }

  // 测试辅助：模拟服务端推送消息
  __message(data) {
    if (this.onmessage) this.onmessage({ data })
  }

  // 测试辅助：模拟异常断开（触发 onclose）
  __close(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED
    if (this.onclose) this.onclose({ code, wasClean: false })
  }

  send(message) {
    this.sent.push(message)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
  }
}

/** 等待指定毫秒 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
