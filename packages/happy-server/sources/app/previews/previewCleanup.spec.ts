import { describe, expect, it, vi } from 'vitest';
import { cleanupInteractivePreviewRows, createPreviewCleanup } from './previewCleanup';

describe('cleanupInteractivePreviewRows', () => {
    it('removes expired draft staging without calling Vercel', async () => {
        const dependencies: any = { deleteStaging: vi.fn(), deleteDeployment: vi.fn(), markExpired: vi.fn() };
        await cleanupInteractivePreviewRows([{ id: 'p1', status: 'draft', accountId: 'u1', stagingGeneration: 'generation-1', vercelDeploymentId: null }], dependencies);
        expect(dependencies.deleteStaging).toHaveBeenCalledWith('u1', 'p1', 'generation-1'); expect(dependencies.deleteDeployment).not.toHaveBeenCalled();
        expect(dependencies.markExpired).toHaveBeenCalledWith('p1');
    });
    it('retains the row for retry when provider deletion fails', async () => {
        const dependencies: any = { deleteStaging: vi.fn(), deleteDeployment: vi.fn(async () => { throw new Error('provider down'); }), markExpired: vi.fn(), retainForRetry: vi.fn() };
        await cleanupInteractivePreviewRows([{ id: 'p2', status: 'failed', accountId: 'u1', stagingGeneration: 'generation-1', vercelDeploymentId: 'dpl_1' }], dependencies);
        expect(dependencies.deleteDeployment).toHaveBeenCalledWith('u1', 'dpl_1');
        expect(dependencies.markExpired).not.toHaveBeenCalled();
        expect(dependencies.retainForRetry).toHaveBeenCalledWith('p2');
    });

    it('retains the provider deployment id for retry when staging cleanup fails', async () => {
        const dependencies: any = {
            deleteStaging: vi.fn(async () => { throw new Error('oss unavailable'); }),
            deleteDeployment: vi.fn(), markExpired: vi.fn(), retainForRetry: vi.fn(),
        };

        await cleanupInteractivePreviewRows([{ id: 'p3', status: 'ready', accountId: 'u1', stagingGeneration: 'generation-1', vercelDeploymentId: 'dpl_3' }], dependencies);

        expect(dependencies.deleteDeployment).toHaveBeenCalledWith('u1', 'dpl_3');
        expect(dependencies.markExpired).not.toHaveBeenCalled();
        expect(dependencies.retainForRetry).toHaveBeenCalledWith('p3');
    });

    it('recovers an expired publishing lease through a cross-replica compare-and-set claim', async () => {
        const updateMany = vi.fn()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 1 });
        const cleanup = createPreviewCleanup({
            database: { interactivePreview: {
                updateMany,
                findMany: vi.fn(async () => [{ id: 'p4', status: 'failed', accountId: 'u1', stagingGeneration: 'generation-1', vercelDeploymentId: 'dpl_4' }]),
                deleteMany: vi.fn(async () => ({ count: 0 })),
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
        expect(updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({
            where: expect.objectContaining({ id: 'p4', status: 'deleting', cleanupClaimedAt: new Date('2026-09-04T01:00:00Z') }),
            data: expect.objectContaining({ status: 'expired', url: null, vercelDeploymentId: null }),
        }));
    });

    it('persists a bounded first retry delay after cleanup failure', async () => {
        const updateMany = vi.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
        const cleanup = createPreviewCleanup({
            database: { interactivePreview: { updateMany, findMany: vi.fn(async () => [{ id: 'p5', status: 'deleting', accountId: 'u1', stagingGeneration: 'generation-1', vercelDeploymentId: null }]), findFirst: vi.fn(async () => ({ cleanupRetryCount: 0 })), deleteMany: vi.fn(async () => ({ count: 0 })) } } as any,
            storage: { deletePreview: vi.fn(async () => { throw new Error('oss down'); }) } as any,
            credentialStore: { get: vi.fn() } as any, clientFactory: vi.fn() as any,
        });

        await cleanup.cleanupExpired(new Date('2026-09-04T01:00:00Z'));

        expect(updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({ data: expect.objectContaining({
            cleanupRetryCount: { increment: 1 }, cleanupNextAttemptAt: new Date('2026-09-04T01:01:00Z'),
        }) }));
    });

    it('retries ready staging cleanup without deleting the live deployment before its 24-hour expiry', async () => {
        const row: any = { id: 'p6', status: 'ready', accountId: 'u1', stagingGeneration: 'generation-1', vercelDeploymentId: 'dpl_live', stagingCleanupPending: true,
            expiresAt: new Date('2026-09-05T01:00:00Z'), cleanupClaimedAt: null, cleanupRetryCount: 0, cleanupNextAttemptAt: null };
        const updateMany = vi.fn(async ({ where, data }: any) => {
            if (where.status === 'publishing') return { count: 0 };
            if (where.status && where.status !== row.status) return { count: 0 };
            Object.entries(data).forEach(([key, value]: any) => { row[key] = value?.increment === undefined ? value : row[key] + value.increment; });
            return { count: 1 };
        });
        const deleteDeployment = vi.fn(async () => {});
        const cleanup = createPreviewCleanup({
            database: { interactivePreview: { updateMany, findMany: vi.fn(async () => [row]), findFirst: vi.fn(async () => row), deleteMany: vi.fn(async () => ({ count: 0 })) } } as any,
            storage: { deletePreview: vi.fn(async () => {}) } as any,
            credentialStore: { get: vi.fn(async () => ({ accessToken: 'secret', configurationId: 'icfg' })) } as any,
            clientFactory: vi.fn(() => ({ deleteDeployment })) as any,
        });

        await cleanup.cleanupExpired(new Date('2026-09-04T01:00:00Z'));

        expect(deleteDeployment).not.toHaveBeenCalled();
        expect(row).toMatchObject({ status: 'ready', vercelDeploymentId: 'dpl_live', stagingCleanupPending: false });
    });

    it('prunes only fully cleaned expired tombstones after the 30-day retention window', async () => {
        const deleteMany = vi.fn(async () => ({ count: 1 }));
        const cleanup = createPreviewCleanup({
            database: { interactivePreview: { updateMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => []), deleteMany } } as any,
            storage: { deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn() } as any,
            clientFactory: vi.fn() as any,
        });

        await cleanup.cleanupExpired(new Date('2026-09-04T01:00:00Z'));

        expect(deleteMany).toHaveBeenCalledWith({ where: {
            status: 'expired', vercelDeploymentId: null, stagingCleanupPending: false,
            updatedAt: { lte: new Date('2026-08-05T01:00:00Z') },
        } });
    });
});
