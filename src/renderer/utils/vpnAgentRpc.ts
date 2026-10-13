import WebSocketClient from "./websocketClient";


export enum IdEnum {
    STATUS,
    CONFIG,
    CONNECT,
    DISCONNECT,
    RECONNECT,
    INTERFACE,
    ABORT,
    STAT
}

const JSONRPC_VERSION = '2.0'
export type JsonRpcRequestMethod = 'status' | 'config' | 'connect' | 'disconnect' | 'reconnect' | 'stat' | 'active';
export interface JsonRpcRequest {
    jsonrpc: "2.0";
    method: JsonRpcRequestMethod;
    params?: any;
    id: number;
}

export class VpnAgentRpc {
    private websocket: WebSocketClient = null
    private callbackMap = new Map<number, (result: Record<string, any>) => void>();
    private timeoutMap = new Map<number, NodeJS.Timeout>();
    private errorCallback: (error: string) => void;
    private openCallback: (error: string) => void;
    private closeCallback: (error: string) => void;
    private reconnectingCallback: (attempt: number) => void;
    constructor() {
        this.websocket = new WebSocketClient()
        this.websocket.setCallbacks({
            onMessage: (data) => {
                this.onRecvMessage(data)
            },
            onOpen: (event) => {
                this.openCallback && this.openCallback(JSON.stringify(event))
            },
            onError: (event) => {
                this.errorCallback && this.errorCallback(JSON.stringify(event))
            },
            onClose: (event) => {
                this.closeCallback && this.closeCallback(JSON.stringify(event))
            },
            onReconnecting: (attempt) => {
                this.reconnectingCallback && this.reconnectingCallback(attempt)
            }
        })
    }

    callAsyncParams(method: JsonRpcRequestMethod, id: number, params: Record<string, any>, callback: (result: Record<string, any>) => void) {
        if (callback) {
            this.callbackMap.set(id, callback)
            // 请求超时保护：若 agent 长时间不响应（如网络阻塞），主动回调错误，避免卡死
            // 仅在调用方提供回调时启用，避免误伤 registerCallback 注册的事件回调（如 id=3/6）
            const timeoutMs = 30000 // 30 秒超时
            const timer = setTimeout(() => {
                if (this.callbackMap.has(id)) {
                    const cb = this.callbackMap.get(id)
                    this.callbackMap.delete(id)
                    this.timeoutMap.delete(id)
                    cb({ id, error: { code: -1, message: 'request timeout' } })
                }
            }, timeoutMs)
            this.timeoutMap.set(id, timer)
        }
        this.sendMessage({
            jsonrpc: JSONRPC_VERSION,
            method: method,
            id: id,
            params: params
        })
    }

    callAsync(method: JsonRpcRequestMethod, id: number, callback: (result: Record<string, any>) => void) {
        this.callAsyncParams(method, id, {}, callback)
    }

    isConnected() {
        return this.websocket.isConnected()
    }

    connectToServer(url: string) {
        // "ws://127.0.0.1:7210/rpc"
        this.websocket.connect(url)
    }

    sendMessage(msg: JsonRpcRequest) {
        console.log('rpc send ->', msg)
        this.websocket.sendMsg(JSON.stringify(msg))
    }

    registerCallback(id: number, callback: (result: Record<string, any>) => void) {
        this.callbackMap.set(id, callback)
    }

    private onRecvMessage(data: string) {
        console.log('rpc recv <-', JSON.parse(data))
        if (!data.includes("id")) {
            this.errorCallback && this.errorCallback('Invalid result')
        }
        const res = JSON.parse(data)
        const id = res['id']

        if (this.callbackMap.has(id)) {
            const cb = this.callbackMap.get(id)
            // 删除回调，避免超时定时器误触发或重复响应
            this.callbackMap.delete(id)
            // 响应到达后清除超时定时器，避免无谓的 pending 任务残留
            const timer = this.timeoutMap.get(id)
            if (timer) {
                clearTimeout(timer)
                this.timeoutMap.delete(id)
            }
            cb(res)
        }
    }

    onError(cb: (error: string) => void) {
        this.errorCallback = cb
    }

    onOpen(cb: (error: string) => void) {
        this.openCallback = cb
    }

    onClose(cb: (error: string) => void) {
        this.closeCallback = cb
    }

    onReconnecting(cb: (attempt: number) => void) {
        this.reconnectingCallback = cb
    }
}



export default VpnAgentRpc


