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
        if (!this.callbackMap.has(id) && callback) {
            this.callbackMap.set(id, callback)
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
            this.callbackMap.get(id)(res)
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


