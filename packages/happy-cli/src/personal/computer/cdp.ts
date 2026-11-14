import WebSocket from 'ws';

/** Private transport for this controller's exact Docker-published endpoint. */
export class ComputerCdp {
    private id = 0;
    private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; finish: () => void }>();
    private listeners = new Map<string, Set<(params: any) => void>>();
    private closed = false;
    private constructor(private readonly socket: WebSocket) {
        socket.on('message', raw => {
            let message: any;
            try { message = JSON.parse(raw.toString()); } catch { return; }
            if (message.id) {
                const pending = this.pending.get(message.id);
                if (!pending) return;
                this.pending.delete(message.id); pending.finish();
                if (message.error) pending.reject(new Error(String(message.error.message ?? 'Browser command failed')));
                else pending.resolve(message.result ?? {});
            } else if (typeof message.method === 'string') {
                for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
            }
        });
        const close = () => {
            this.closed = true;
            for (const pending of this.pending.values()) { pending.finish(); pending.reject(new Error('Computer connection closed')); }
            this.pending.clear();
            for (const listener of this.listeners.get('closed') ?? []) listener({});
        };
        socket.once('close', close); socket.once('error', close);
    }

    static async connect(url: string, signal?: AbortSignal): Promise<ComputerCdp> {
        const parsed = new URL(url);
        if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password) throw new Error('Computer endpoint must be loopback');
        signal?.throwIfAborted();
        const socket = new WebSocket(url, { handshakeTimeout: 15_000, maxPayload: 4 * 1024 * 1024 });
        await new Promise<void>((resolve, reject) => {
            const abort = () => { socket.terminate(); reject(new Error('Computer connection cancelled')); };
            const finish = () => signal?.removeEventListener('abort', abort);
            socket.once('open', () => { finish(); resolve(); });
            socket.once('error', error => { finish(); reject(error); });
            signal?.addEventListener('abort', abort, { once: true });
        });
        return new ComputerCdp(socket);
    }

    on(method: string, listener: (params: any) => void): () => void {
        const listeners = this.listeners.get(method) ?? new Set();
        listeners.add(listener); this.listeners.set(method, listeners);
        return () => listeners.delete(listener);
    }

    request<T = any>(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted();
        if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Computer connection is unavailable'));
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => cancel(new Error('Computer command timed out')), 20_000);
            const abort = () => cancel(new Error('Computer command cancelled'));
            const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
            const cancel = (error: Error) => { this.pending.delete(id); finish(); reject(error); };
            this.pending.set(id, { resolve, reject, finish });
            signal?.addEventListener('abort', abort, { once: true });
            this.socket.send(JSON.stringify({ id, method, params }), error => { if (error) cancel(error); });
        });
    }

    close(): void { this.closed = true; this.socket.terminate(); }
}
