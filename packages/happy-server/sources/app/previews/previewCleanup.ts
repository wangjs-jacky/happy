import { db } from '@/storage/db';
import { onShutdown } from '@/utils/shutdown';
import { log } from '@/utils/log';
import { previewStorage } from './previewStorage';
import { vercelCredentialStore } from './vercelCredentialStore';
import { createVercelClient } from './vercelClient';

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const CLAIM_TTL_MS = 15 * 60 * 1000;

export type CleanupPreviewRow = { id: string; status: string; accountId: string; vercelDeploymentId: string | null };
export interface PreviewCleanupDependencies {
    deleteStaging(previewId: string): Promise<void>;
    deleteDeployment(accountId: string, deploymentId: string): Promise<void>;
    markExpired(previewId: string): Promise<void>;
}

export async function cleanupInteractivePreviewRows(rows: CleanupPreviewRow[], dependencies: PreviewCleanupDependencies): Promise<number> {
    let cleaned = 0;
    for (const row of rows) {
        try {
            if (row.status === 'ready' && row.vercelDeploymentId) await dependencies.deleteDeployment(row.accountId, row.vercelDeploymentId);
            await dependencies.deleteStaging(row.id);
            await dependencies.markExpired(row.id);
            cleaned++;
        } catch (error) {
            log({ module: 'interactive-preview-cleanup', level: 'error', previewId: row.id, error: error instanceof Error ? error.name : 'unknown' }, 'Preview cleanup failed; retaining tombstone for retry');
        }
    }
    return cleaned;
}

export async function cleanupExpiredInteractivePreviews(now = new Date()): Promise<number> {
    const due = await db.interactivePreview.findMany({
        where: { status: { in: ['draft', 'failed', 'ready'] }, expiresAt: { lte: now }, OR: [
            { cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: new Date(now.getTime() - CLAIM_TTL_MS) } },
        ] }, take: 50, orderBy: { expiresAt: 'asc' },
        select: { id: true, status: true, accountId: true, vercelDeploymentId: true },
    });
    const claimed: CleanupPreviewRow[] = [];
    for (const row of due) {
        const result = await db.interactivePreview.updateMany({ where: {
            id: row.id, status: row.status, expiresAt: { lte: now }, OR: [
                { cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: new Date(now.getTime() - CLAIM_TTL_MS) } },
            ],
        }, data: { cleanupClaimedAt: now } });
        if (result.count === 1) claimed.push(row);
    }
    return cleanupInteractivePreviewRows(claimed, {
        deleteStaging: (previewId) => previewStorage.deletePreview(previewId),
        async deleteDeployment(accountId, deploymentId) {
            const credential = await vercelCredentialStore.get(accountId);
            if (!credential) throw new Error('Vercel credential unavailable');
            await createVercelClient({ token: credential.accessToken, teamId: credential.teamId }).deleteDeployment(deploymentId);
        },
        async markExpired(previewId) {
            await db.interactivePreview.update({ where: { id: previewId }, data: { status: 'expired', url: null, cleanupClaimedAt: null } });
        },
    });
}

export function startInteractivePreviewCleanup(): void {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await cleanupExpiredInteractivePreviews(); }
        catch (error) { log({ module: 'interactive-preview-cleanup', level: 'error', error }, 'Preview cleanup pass failed; it will be retried'); }
        finally { running = false; }
    };
    const timer = setInterval(() => void run(), CLEANUP_INTERVAL_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    onShutdown('interactive-preview-cleanup', async () => clearInterval(timer));
    void run();
}
