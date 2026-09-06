import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    afterTx: vi.fn(),
    transaction: {
        session: { findFirst: vi.fn(async () => ({ id: 'session-1', accountId: 'account-1' })), delete: vi.fn(async () => {}) },
        sessionMessage: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        usageReport: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        accessKey: { deleteMany: vi.fn(async () => ({ count: 0 })) },
        interactivePreview: { updateMany: vi.fn(async () => ({ count: 1 })) },
    },
}));

vi.mock('@/storage/inTx', () => ({ inTx: async (work: (tx: typeof state.transaction) => Promise<unknown>) => work(state.transaction), afterTx: state.afterTx }));
vi.mock('@/app/events/eventRouter', () => ({ eventRouter: { emitUpdate: vi.fn() }, buildDeleteSessionUpdate: vi.fn() }));
vi.mock('@/storage/seq', () => ({ allocateUserSeq: vi.fn() }));
vi.mock('@/utils/randomKeyNaked', () => ({ randomKeyNaked: vi.fn() }));
vi.mock('@/utils/log', () => ({ log: vi.fn() }));
vi.mock('@/storage/files', () => ({ deleteSessionAttachments: vi.fn() }));

import { sessionDelete } from './sessionDelete';

describe('sessionDelete preview cleanup', () => {
    it('leaves owned previews as fenced deleting tombstones before the session relation is removed', async () => {
        await expect(sessionDelete({ uid: 'account-1' } as any, 'session-1')).resolves.toBe(true);

        expect(state.transaction.interactivePreview.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ accountId: 'account-1', sessionId: 'session-1', status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] } }),
            data: expect.objectContaining({ status: 'deleting', url: null, errorCode: 'SESSION_DELETED_CLEANUP_PENDING', publicationGeneration: { increment: 1 }, connectionGeneration: { increment: 1 } }),
        }));
        expect(state.transaction.session.delete).toHaveBeenCalledAfter(state.transaction.interactivePreview.updateMany);
    });
});
