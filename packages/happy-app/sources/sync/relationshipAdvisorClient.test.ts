import { describe, expect, it, vi } from 'vitest';

vi.mock('./apiSocket', () => ({
    apiSocket: {
        onMessage: vi.fn(),
        onStatusChange: vi.fn(),
        emitWithAck: vi.fn(),
        send: vi.fn(),
    },
}));

import { RelationshipAdvisorClient } from './relationshipAdvisorClient';

describe('RelationshipAdvisorClient', () => {
    it.each([false, true])('handles an empty stream with cancellation=%s', async (cancelled) => {
        let listener: (event: unknown) => void = () => undefined;
        const client = new RelationshipAdvisorClient({
            onMessage: (_name, callback) => { listener = callback; return vi.fn(); },
            onStatusChange: () => vi.fn(), emitWithAck: async () => ({ ok: true }), send: () => true,
        });
        const onEvent = vi.fn();
        await client.start({ requestId: 'empty', messages: [{ role: 'user', text: 'hello' }], imageRefs: [] }, onEvent);
        listener({ requestId: 'empty', type: 'delta', text: ' \n' });
        if (cancelled) client.cancel('empty');
        listener({ requestId: 'empty', type: 'done' });
        expect(onEvent).toHaveBeenCalledExactlyOnceWith(cancelled
            ? { requestId: 'empty', type: 'done' }
            : { requestId: 'empty', type: 'error', error: 'empty_response' });
    });
    it('subscribes before starting and forwards only events for the active request', async () => {
        let socketListener: ((event: unknown) => void) | undefined;
        const unsubscribe = vi.fn();
        const unsubscribeStatus = vi.fn();
        const transport = {
            onMessage: vi.fn((_event: string, listener: (event: unknown) => void) => {
                socketListener = listener;
                return unsubscribe;
            }),
            onStatusChange: vi.fn((listener: (status: 'connected') => void) => {
                listener('connected');
                return unsubscribeStatus;
            }),
            emitWithAck: vi.fn(async () => ({ ok: true })),
            send: vi.fn(),
        };
        const onEvent = vi.fn();
        const client = new RelationshipAdvisorClient(transport);

        const stopListening = await client.start({
            requestId: 'request-1',
            messages: [{ role: 'user', text: '帮我分析' }],
            imageRefs: [],
        }, onEvent);

        expect(transport.onMessage.mock.invocationCallOrder[0]).toBeLessThan(
            transport.emitWithAck.mock.invocationCallOrder[0],
        );
        socketListener?.({ requestId: 'other-request', type: 'delta', text: 'wrong' });
        socketListener?.({ requestId: 'request-1', type: 'delta', text: '收到' });
        expect(onEvent).toHaveBeenCalledTimes(1);
        expect(onEvent).toHaveBeenCalledWith({ requestId: 'request-1', type: 'delta', text: '收到' });

        stopListening();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(unsubscribeStatus).toHaveBeenCalledTimes(1);
    });

    it('removes the stream listener when the start acknowledgement fails', async () => {
        const unsubscribe = vi.fn();
        const transport = {
            onMessage: vi.fn(() => unsubscribe),
            onStatusChange: vi.fn(() => vi.fn()),
            emitWithAck: vi.fn(async () => { throw new Error('socket timeout'); }),
            send: vi.fn(),
        };
        const client = new RelationshipAdvisorClient(transport);

        await expect(client.start({
            requestId: 'request-2',
            messages: [{ role: 'user', text: '在吗' }],
            imageRefs: [],
        }, vi.fn())).rejects.toThrow('socket timeout');

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('terminates an acknowledged stream when the socket disconnects', async () => {
        let statusListener: ((status: 'disconnected' | 'connecting' | 'connected' | 'error') => void) | undefined;
        const unsubscribeEvent = vi.fn();
        const unsubscribeStatus = vi.fn();
        const transport = {
            onMessage: vi.fn(() => unsubscribeEvent),
            onStatusChange: vi.fn((listener: typeof statusListener) => {
                statusListener = listener;
                listener?.('connected');
                return unsubscribeStatus;
            }),
            emitWithAck: vi.fn(async () => ({ ok: true })),
            send: vi.fn(),
        };
        const onEvent = vi.fn();
        const client = new RelationshipAdvisorClient(transport);

        await client.start({
            requestId: 'request-3',
            messages: [{ role: 'user', text: '继续分析' }],
            imageRefs: [],
        }, onEvent);
        statusListener?.('disconnected');

        expect(onEvent).toHaveBeenCalledWith({
            requestId: 'request-3',
            type: 'error',
            error: 'Relationship advisor is temporarily unavailable',
        });
        expect(unsubscribeEvent).toHaveBeenCalledTimes(1);
        expect(unsubscribeStatus).toHaveBeenCalledTimes(1);
    });
});
