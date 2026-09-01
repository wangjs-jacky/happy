import { describe, expect, it, vi } from 'vitest';

import { rpcHandler } from '@/app/api/socket/rpcHandler';

type Listener = (...args: any[]) => void;

class FakeCallerSocket {
    readonly id = 'caller';
    private listeners = new Map<string, Listener>();

    on(event: string, listener: Listener) {
        this.listeners.set(event, listener);
        return this;
    }

    emit() {
        return true;
    }

    receive(event: string, ...args: unknown[]) {
        const listener = this.listeners.get(event);
        if (!listener) throw new Error(`No listener registered for ${event}`);
        return listener(...args);
    }
}

class FakeTargetSocket {
    readonly id = 'target';
    readonly timeout = vi.fn((timeoutMs: number) => ({
        emitWithAck: vi.fn(() => new Promise<string>((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error('operation has timed out'));
                }
            }, timeoutMs);
            this.ack().then((response) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    resolve(response);
                }
            }, (error) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(error);
                }
            });
        })),
    }));
    ack: () => Promise<string> = async () => 'encrypted-response';
}

function createIo(target: FakeTargetSocket) {
    return {
        in: vi.fn(() => ({
            timeout: vi.fn(() => ({
                fetchSockets: vi.fn(async () => [target]),
            })),
        })),
    };
}

async function callRpc(
    method: string,
    target: FakeTargetSocket,
    params: Record<string, unknown> = {},
) {
    const caller = new FakeCallerSocket();
    const io = createIo(target);
    rpcHandler('user-1', caller as any, io as any);
    const acknowledge = vi.fn();

    const request = caller.receive('rpc-call', { method, params }, acknowledge);
    await request;

    return { acknowledge, io };
}

describe('rpcHandler', () => {
    it('keeps ordinary RPC calls on the 30-second target acknowledgement timeout', async () => {
        const target = new FakeTargetSocket();

        const { acknowledge } = await callRpc('machine-1:bash', target);

        expect(target.timeout).toHaveBeenCalledWith(30_000);
        expect(acknowledge).toHaveBeenCalledWith({ ok: true, result: 'encrypted-response' });
    });

    it.each([
        'machine-1:spawn-happy-session',
        'machine-1:resume-happy-session',
    ])('gives %s the longer startup acknowledgement timeout', async (method) => {
        const target = new FakeTargetSocket();

        const { acknowledge } = await callRpc(method, target);

        expect(target.timeout).toHaveBeenCalledWith(100_000);
        expect(acknowledge).toHaveBeenCalledWith({ ok: true, result: 'encrypted-response' });
    });

    it('allows a startup RPC acknowledgement after 90 seconds', async () => {
        vi.useFakeTimers();
        try {
            const target = new FakeTargetSocket();
            target.ack = () => new Promise<string>((resolve) => {
                setTimeout(() => resolve('encrypted-response'), 90_000);
            });
            const caller = new FakeCallerSocket();
            const io = createIo(target);
            rpcHandler('user-1', caller as any, io as any);
            const acknowledge = vi.fn();

            const request = caller.receive('rpc-call', {
                method: 'machine-1:spawn-happy-session',
                params: {},
            }, acknowledge);
            await vi.advanceTimersByTimeAsync(90_000);
            await request;

            expect(target.timeout).toHaveBeenCalledWith(100_000);
            expect(acknowledge).toHaveBeenCalledWith({ ok: true, result: 'encrypted-response' });
        } finally {
            vi.useRealTimers();
        }
    });
});
