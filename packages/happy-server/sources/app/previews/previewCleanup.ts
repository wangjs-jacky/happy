import { db } from '@/storage/db';
import { onShutdown } from '@/utils/shutdown';
import { log } from '@/utils/log';
import { previewStorage } from './previewStorage';
import { vercelCredentialStore } from './vercelCredentialStore';
import { createVercelClient } from './vercelClient';

const CLEANUP_INTERVAL_MS = 60 * 1000;
const CLAIM_TTL_MS = 15 * 60 * 1000;

export type CleanupPreviewRow = { id: string; status: string; accountId: string; vercelDeploymentId: string | null };
export interface PreviewCleanupDependencies {
    deleteStaging(previewId: string): Promise<void>;
    deleteDeployment(accountId: string, deploymentId: string): Promise<void>;
    markExpired(previewId: string): Promise<void>;
    retainForRetry(previewId: string): Promise<void>;
}

export async function cleanupInteractivePreviewRows(rows: CleanupPreviewRow[], dependencies: PreviewCleanupDependencies): Promise<number> {
    let cleaned = 0;
    for (const row of rows) {
        try {
            if (row.vercelDeploymentId) await dependencies.deleteDeployment(row.accountId, row.vercelDeploymentId);
            await dependencies.deleteStaging(row.id);
            await dependencies.markExpired(row.id);
            cleaned++;
        } catch (error) {
            await Promise.resolve(dependencies.retainForRetry(row.id)).catch(() => undefined);
            log({ module: 'interactive-preview-cleanup', level: 'error', previewId: row.id, error: error instanceof Error ? error.name : 'unknown' }, 'Preview cleanup failed; retaining tombstone for retry');
        }
    }
    return cleaned;
}

type PreviewDatabase = Pick<typeof db, 'interactivePreview'>;

export function createPreviewCleanup(dependencies: {
    database: PreviewDatabase;
    storage: Pick<typeof previewStorage, 'deletePreview'>;
    credentialStore: Pick<typeof vercelCredentialStore, 'get'>;
    clientFactory: typeof createVercelClient;
    now?: () => Date;
}) {
    const now = dependencies.now ?? (() => new Date());
    const staleClaim = (time: Date) => new Date(time.getTime() - CLAIM_TTL_MS);

    async function recoverStalePublications(time: Date): Promise<void> {
        await dependencies.database.interactivePreview.updateMany({
            where: { status: 'publishing', updatedAt: { lte: staleClaim(time) } },
            data: { status: 'failed', errorCode: 'PUBLISH_LEASE_EXPIRED', cleanupClaimedAt: null },
        });
    }

    async function cleanupExpired(time = now()): Promise<number> {
        await recoverStalePublications(time);
        const claimBefore = staleClaim(time);
        const due = await dependencies.database.interactivePreview.findMany({
            where: {
                OR: [
                    { status: 'deleting' },
                    { status: { in: ['draft', 'failed', 'ready'] }, expiresAt: { lte: time } },
                ],
                AND: [{ OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: claimBefore } }] }],
            },
            take: 50, orderBy: { expiresAt: 'asc' },
            select: { id: true, status: true, accountId: true, vercelDeploymentId: true },
        }) as CleanupPreviewRow[];
        const claimed: CleanupPreviewRow[] = [];
        for (const row of due) {
            const result = await dependencies.database.interactivePreview.updateMany({ where: {
                id: row.id, status: row.status,
                OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: claimBefore } }],
            }, data: { status: 'deleting', cleanupClaimedAt: time } });
            if (result.count === 1) claimed.push(row);
        }
        return cleanupInteractivePreviewRows(claimed, {
            deleteStaging: (previewId) => dependencies.storage.deletePreview(previewId),
            async deleteDeployment(accountId, deploymentId) {
                const credential = await dependencies.credentialStore.get(accountId);
                if (!credential) throw new Error('Vercel credential unavailable');
                await dependencies.clientFactory({ token: credential.accessToken, teamId: credential.teamId }).deleteDeployment(deploymentId);
            },
            async markExpired(previewId) {
                await dependencies.database.interactivePreview.update({ where: { id: previewId }, data: { status: 'expired', url: null, cleanupClaimedAt: null } });
            },
            async retainForRetry(previewId) {
                await dependencies.database.interactivePreview.update({ where: { id: previewId }, data: { status: 'deleting', cleanupClaimedAt: null } });
            },
        });
    }

    return { cleanupExpired, recoverStalePublications };
}

const defaultPreviewCleanup = createPreviewCleanup({ database: db, storage: previewStorage, credentialStore: vercelCredentialStore, clientFactory: createVercelClient });

export async function cleanupExpiredInteractivePreviews(now = new Date()): Promise<number> {
    return defaultPreviewCleanup.cleanupExpired(now);
}

export function startInteractivePreviewCleanup(): void {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await cleanupExpiredInteractivePreviews(); }
        catch { log({ module: 'interactive-preview-cleanup', level: 'error' }, 'Preview cleanup pass failed; it will be retried'); }
        finally { running = false; }
    };
    const timer = setInterval(() => void run(), CLEANUP_INTERVAL_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    onShutdown('interactive-preview-cleanup', async () => clearInterval(timer));
    void run();
}
