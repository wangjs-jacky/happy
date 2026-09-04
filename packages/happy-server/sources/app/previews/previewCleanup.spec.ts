import { describe, expect, it, vi } from 'vitest';
import { cleanupInteractivePreviewRows, createPreviewCleanup } from './previewCleanup';

describe('cleanupInteractivePreviewRows', () => {
    it('removes expired draft staging without calling Vercel', async () => {
        const dependencies: any = { deleteStaging: vi.fn(), deleteDeployment: vi.fn(), markExpired: vi.fn() };
        await cleanupInteractivePreviewRows([{ id: 'p1', status: 'draft', accountId: 'u1', vercelDeploymentId: null }], dependencies);
        expect(dependencies.deleteStaging).toHaveBeenCalledWith('p1'); expect(dependencies.deleteDeployment).not.toHaveBeenCalled();
        expect(dependencies.markExpired).toHaveBeenCalledWith('p1');
    });
    it('retains the row for retry when provider deletion fails', async () => {
        const dependencies: any = { deleteStaging: vi.fn(), deleteDeployment: vi.fn(async () => { throw new Error('provider down'); }), markExpired: vi.fn(), retainForRetry: vi.fn() };
        await cleanupInteractivePreviewRows([{ id: 'p2', status: 'failed', accountId: 'u1', vercelDeploymentId: 'dpl_1' }], dependencies);
        expect(dependencies.deleteDeployment).toHaveBeenCalledWith('u1', 'dpl_1');
        expect(dependencies.markExpired).not.toHaveBeenCalled();
        expect(dependencies.retainForRetry).toHaveBeenCalledWith('p2');
    });

    it('retains the provider deployment id for retry when staging cleanup fails', async () => {
        const dependencies: any = {
            deleteStaging: vi.fn(async () => { throw new Error('oss unavailable'); }),
            deleteDeployment: vi.fn(), markExpired: vi.fn(), retainForRetry: vi.fn(),
        };

        await cleanupInteractivePreviewRows([{ id: 'p3', status: 'ready', accountId: 'u1', vercelDeploymentId: 'dpl_3' }], dependencies);

        expect(dependencies.deleteDeployment).toHaveBeenCalledWith('u1', 'dpl_3');
        expect(dependencies.markExpired).not.toHaveBeenCalled();
        expect(dependencies.retainForRetry).toHaveBeenCalledWith('p3');
    });

    it('recovers an expired publishing lease through a cross-replica compare-and-set claim', async () => {
        const updateMany = vi.fn()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 1 });
        const update = vi.fn(async () => {});
        const cleanup = createPreviewCleanup({
            database: { interactivePreview: {
                updateMany,
                findMany: vi.fn(async () => [{ id: 'p4', status: 'failed', accountId: 'u1', vercelDeploymentId: 'dpl_4' }]),
                update,
            } } as any,
            storage: { deletePreview: vi.fn(async () => {}) } as any,
            credentialStore: { get: vi.fn(async () => ({ accessToken: 'secret', configurationId: 'icfg' })) } as any,
            clientFactory: vi.fn(() => ({ deleteDeployment: vi.fn(async () => {}) })) as any,
        });

        await cleanup.cleanupExpired(new Date('2026-09-04T01:00:00Z'));

        expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({ status: 'publishing', updatedAt: { lte: new Date('2026-09-04T00:45:00Z') } }),
            data: expect.objectContaining({ status: 'failed', errorCode: 'PUBLISH_LEASE_EXPIRED' }),
        }));
        expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({ id: 'p4', status: 'failed' }), data: expect.objectContaining({ status: 'deleting' }),
        }));
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p4' }, data: expect.objectContaining({ status: 'expired', url: null }) }));
    });

    it('persists a bounded first retry delay after cleanup failure', async () => {
        const updateMany = vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
        const update = vi.fn(async () => {});
        const cleanup = createPreviewCleanup({
            database: { interactivePreview: { updateMany, findMany: vi.fn(async () => [{ id: 'p5', status: 'deleting', accountId: 'u1', vercelDeploymentId: null }]), findFirst: vi.fn(async () => ({ cleanupRetryCount: 0 })), update } } as any,
            storage: { deletePreview: vi.fn(async () => { throw new Error('oss down'); }) } as any,
            credentialStore: { get: vi.fn() } as any, clientFactory: vi.fn() as any,
        });

        await cleanup.cleanupExpired(new Date('2026-09-04T01:00:00Z'));

        expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
            cleanupRetryCount: { increment: 1 }, cleanupNextAttemptAt: new Date('2026-09-04T01:01:00Z'),
        }) }));
    });
});
