export interface WebSocketCallbacks {
    onMessage?: (data: string) => void;
    onOpen?: (event: Event) => void;
    onClose?: (event: CloseEvent) => void;
    onError?: (error: Event) => void;
    onReconnecting?: (attempt: number) => void;
}

export class WebSocketClient {
    private ws: WebSocket | null = null;
    private url: string = "";
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectInterval: number = 3000; // ms
    // 是否使用指数退避，超过该阈值后按倍数递增间隔
    private useExponentialBackoff: boolean = true;
    private maxReconnectInterval: number = 30000; // ms
    // 是否允许无限重连（为 true 时忽略 maxReconnectAttempts）
    private infiniteReconnect: boolean = false;
    // 手动断开标记，用于区分「用户主动断开」与「网络异常断开」
    private manualClose: boolean = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    private onMessage: ((data: string) => void) | null = null;
    private onOpen: ((event: Event) => void) | null = null;
    private onClose: ((event: CloseEvent) => void) | null = null;
    private onError: ((error: Event) => void) | null = null;
    private onReconnecting: ((attempt: number) => void) | null = null;

    constructor() {}

    connect(url: string): void {
        this.url = url;
        this.manualClose = false;

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return;
        }

        // 连接中则不重复发起
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            return;
        }

        try {
            this.ws = new WebSocket(url);

            this.ws.onopen = (event: Event) => {
                this.reconnectAttempts = 0;
                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }

                if (this.onOpen) {
                    this.onOpen(event);
                }
            };

            this.ws.onmessage = (event: MessageEvent) => {
                if (this.onMessage) {
                    this.onMessage(event.data);
                }
            };

            this.ws.onclose = (event: CloseEvent) => {
                if (this.onClose) {
                    this.onClose(event);
                }

                // 手动断开则不再自动重连
                if (this.manualClose) {
                    return;
                }

                this.scheduleReconnect();
            };

            this.ws.onerror = (error: Event) => {
                if (this.onError) {
                    this.onError(error);
                }
            };

        } catch (error) {
            if (this.onError) {
                this.onError(error as Event);
            }
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        // 已经排了定时器则跳过
        if (this.reconnectTimer) {
            return;
        }

        const canReconnect = this.infiniteReconnect || this.reconnectAttempts < this.maxReconnectAttempts;
        if (!canReconnect) {
            return;
        }

        let delay = this.reconnectInterval;
        if (this.useExponentialBackoff && this.reconnectAttempts > 0) {
            // 2^n 退避，封顶 maxReconnectInterval
            delay = Math.min(this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectInterval);
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.reconnectAttempts++;
            if (this.onReconnecting) {
                this.onReconnecting(this.reconnectAttempts);
            }
            this.connect(this.url);
        }, delay);
    }

    disconnect(): void {
        this.manualClose = true;
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            // 去掉回调避免 close 触发重连
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
    }

    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    // 发送消息
    sendMsg(message: string): boolean {
        if (this.isConnected()) {
            this.ws!.send(message);
            return true;
        } else {
            return false;
        }
    }

    setCallbacks(callbacks: WebSocketCallbacks): void {
        if (callbacks.onMessage) this.onMessage = callbacks.onMessage;
        if (callbacks.onOpen) this.onOpen = callbacks.onOpen;
        if (callbacks.onClose) this.onClose = callbacks.onClose;
        if (callbacks.onError) this.onError = callbacks.onError;
        if (callbacks.onReconnecting) this.onReconnecting = callbacks.onReconnecting;
    }

    getReconnectAttempts(): number {
        return this.reconnectAttempts;
    }

    getMaxReconnectAttempts(): number {
        return this.maxReconnectAttempts;
    }

    setMaxReconnectAttempts(attempts: number): void {
        this.maxReconnectAttempts = attempts;
    }

    setReconnectInterval(interval: number): void {
        this.reconnectInterval = interval;
    }

    setUseExponentialBackoff(use: boolean): void {
        this.useExponentialBackoff = use;
    }

    setMaxReconnectInterval(interval: number): void {
        this.maxReconnectInterval = interval;
    }

    setInfiniteReconnect(infinite: boolean): void {
        this.infiniteReconnect = infinite;
    }
}

export default WebSocketClient;
