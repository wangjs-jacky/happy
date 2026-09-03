import { describe, expect, it, vi } from 'vitest';
import { cleanupInteractivePreviewRows } from './previewCleanup';

describe('cleanupInteractivePreviewRows', () => {
    it('removes expired draft staging without calling Vercel', async () => {
        const dependencies: any = { deleteStaging: vi.fn(), deleteDeployment: vi.fn(), markExpired: vi.fn() };
        await cleanupInteractivePreviewRows([{ id: 'p1', status: 'draft', accountId: 'u1', vercelDeploymentId: null }], dependencies);
        expect(dependencies.deleteStaging).toHaveBeenCalledWith('p1'); expect(dependencies.deleteDeployment).not.toHaveBeenCalled();
        expect(dependencies.markExpired).toHaveBeenCalledWith('p1');
    });
    it('retains the row for retry when provider deletion fails', async () => {
        const dependencies: any = { deleteStaging: vi.fn(), deleteDeployment: vi.fn(async () => { throw new Error('provider down'); }), markExpired: vi.fn() };
        await cleanupInteractivePreviewRows([{ id: 'p2', status: 'failed', accountId: 'u1', vercelDeploymentId: 'dpl_1' }], dependencies);
        expect(dependencies.deleteDeployment).toHaveBeenCalledWith('u1', 'dpl_1');
        expect(dependencies.markExpired).not.toHaveBeenCalled();
    });
});
