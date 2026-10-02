import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { sessionUpdateHandler } from './sessionUpdateHandler';

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    emitUpdate: vi.fn(),
    allocateUserSeq: vi.fn(async () => 1),
}));

vi.mock('@/storage/db', () => ({ db: { session: {
    findUnique: mocks.findUnique,
    updateMany: mocks.updateMany,
} } }));
vi.mock('@/storage/seq', () => ({ allocateUserSeq: mocks.allocateUserSeq }));
vi.mock('@/storage/inTx', () => ({ inTx: vi.fn() }));
vi.mock('@/app/presence/sessionCache', () => ({ activityCache: {} }));
vi.mock('@/app/monitoring/metrics2', () => ({ getMetricsLabelsFromSocket: () => ({}) }));
vi.mock('@/app/events/eventRouter', () => ({
    eventRouter: { emitUpdate: mocks.emitUpdate },
    buildUpdateSessionUpdate: (id: string, seq: number, _eventId: string, metadata: unknown) => ({ id, seq, metadata }),
}));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));

type MetadataReply = { result: string; version?: number; metadata?: string };

function setup() {
    const listeners = new Map<string, (...args: any[]) => Promise<unknown>>();
    const socket = { on: (event: string, listener: (...args: any[]) => Promise<unknown>) => listeners.set(event, listener) } as unknown as Socket;
    sessionUpdateHandler('owner', socket, { connectionType: 'user-scoped', socket, userId: 'owner' });
    return async (expectedVersion: number, metadata: string): Promise<MetadataReply> => {
        const callback = vi.fn();
        await listeners.get('update-metadata')!({ sid: 'session', metadata, expectedVersion }, callback);
        expect(callback).toHaveBeenCalledTimes(1);
        return callback.mock.calls[0][0];
    };
}

describe('session metadata optimistic concurrency', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns the winning write when a concurrent startup update wins after the initial read', async () => {
        let row = { metadataVersion: 0, metadata: 'cipher:initial' };
        mocks.findUnique.mockImplementation(async () => ({ ...row }));
        mocks.updateMany
            .mockImplementationOnce(async () => {
                // CLI startup committed after the App read v0 but before its CAS.
                row = { metadataVersion: 1, metadata: 'cipher:cli-startup' };
                return { count: 0 };
            })
            .mockImplementationOnce(async ({ where, data }) => {
                if (where.metadataVersion !== row.metadataVersion) return { count: 0 };
                row = { metadataVersion: data.metadataVersion, metadata: data.metadata };
                return { count: 1 };
            });
        const send = setup();

        const conflict = await send(0, 'cipher:agent-binding');
        expect(conflict).toEqual({ result: 'version-mismatch', version: 1, metadata: 'cipher:cli-startup' });
        expect(mocks.findUnique).toHaveBeenLastCalledWith({
            where: { id: 'session', accountId: 'owner' },
            select: { metadataVersion: true, metadata: true },
        });
        expect(mocks.emitUpdate).not.toHaveBeenCalled();

        // A client rebases on this ACK; the next request must not spend another
        // bounded retry rediscovering the version of the same winning write.
        const retry = await send(conflict.version!, 'cipher:cli-startup+agent-binding');
        expect(retry).toEqual({ result: 'success', version: 2, metadata: 'cipher:cli-startup+agent-binding' });
        expect(mocks.updateMany).toHaveBeenCalledTimes(2);
        expect(mocks.emitUpdate).toHaveBeenCalledTimes(1);
    });

    it('returns the current encrypted snapshot for a request already stale at lookup', async () => {
        mocks.findUnique.mockResolvedValueOnce({ metadataVersion: 5, metadata: 'cipher:latest' });
        expect(await setup()(2, 'cipher:stale')).toEqual({ result: 'version-mismatch', version: 5, metadata: 'cipher:latest' });
        expect(mocks.updateMany).not.toHaveBeenCalled();
        expect(mocks.emitUpdate).not.toHaveBeenCalled();
    });

    it('reports an error if the session disappears during CAS instead of returning a stale conflict', async () => {
        mocks.findUnique
            .mockResolvedValueOnce({ metadataVersion: 0, metadata: 'cipher:initial' })
            .mockResolvedValueOnce(null);
        mocks.updateMany.mockResolvedValueOnce({ count: 0 });
        expect(await setup()(0, 'cipher:agent-binding')).toEqual({ result: 'error' });
        expect(mocks.emitUpdate).not.toHaveBeenCalled();
    });
});
