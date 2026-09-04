import { db } from '@/storage/db';
import { onShutdown } from '@/utils/shutdown';
import { log } from '@/utils/log';
import { previewStorage } from './previewStorage';
import { vercelCredentialStore } from './vercelCredentialStore';
import { createVercelClient } from './vercelClient';

const CLEANUP_INTERVAL_MS = 60 * 1000;
const CLAIM_TTL_MS = 15 * 60 * 1000;
const RETRY_BASE_MS = 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;

const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type CleanupPreviewRow = {
    id: string; status: string; accountId: string; stagingGeneration: string; vercelDeploymentId: string | null;
    stagingCleanupPending?: boolean; expiresAt?: Date;
};
export interface PreviewCleanupDependencies {
    deleteStaging(accountId: string, previewId: string, stagingGeneration: string): Promise<void>;
    deleteDeployment(accountId: string, deploymentId: string): Promise<void>;
    markExpired(previewId: string): Promise<void>;
    retainForRetry(previewId: string): Promise<void>;
    markStagingClean?(previewId: string): Promise<void>;
}

export async function cleanupInteractivePreviewRows(rows: CleanupPreviewRow[], dependencies: PreviewCleanupDependencies): Promise<number> {
    let cleaned = 0;
    for (const row of rows) {
        try {
            if (row.status === 'ready' && row.stagingCleanupPending) {
                await dependencies.deleteStaging(row.accountId, row.id, row.stagingGeneration);
                if (dependencies.markStagingClean) await dependencies.markStagingClean(row.id);
                else await dependencies.markExpired(row.id);
                cleaned++;
                continue;
            }
            if (row.vercelDeploymentId) await dependencies.deleteDeployment(row.accountId, row.vercelDeploymentId);
            await dependencies.deleteStaging(row.accountId, row.id, row.stagingGeneration);
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
    const retryAt = (time: Date, retryCount: number) => new Date(time.getTime() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(retryCount, 10)));

    async function recoverStalePublications(time: Date): Promise<void> {
        await dependencies.database.interactivePreview.updateMany({
            where: { status: 'publishing', updatedAt: { lte: staleClaim(time) } },
            data: { status: 'failed', errorCode: 'PUBLISH_LEASE_EXPIRED', cleanupClaimedAt: null, cleanupNextAttemptAt: null },
        });
    }

    async function cleanupExpired(time = now()): Promise<number> {
        await recoverStalePublications(time);
        const claimBefore = staleClaim(time);
        const due = await dependencies.database.interactivePreview.findMany({
            where: {
                OR: [
                    { status: 'deleting' },
                    { status: 'ready', stagingCleanupPending: true },
                    { status: { in: ['draft', 'failed', 'ready'] }, expiresAt: { lte: time } },
                ],
                AND: [
                    { OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: claimBefore } }] },
                    { OR: [{ cleanupNextAttemptAt: null }, { cleanupNextAttemptAt: { lte: time } }] },
                ],
            },
            take: 50, orderBy: { expiresAt: 'asc' },
            select: { id: true, status: true, accountId: true, stagingGeneration: true, vercelDeploymentId: true, stagingCleanupPending: true, expiresAt: true },
        }) as CleanupPreviewRow[];
        const claimed: CleanupPreviewRow[] = [];
        const claims = new Map<string, { status: string; stagingCleanupPending: boolean }>();
        for (const row of due) {
            const stagingOnly = row.status === 'ready' && row.stagingCleanupPending === true && row.expiresAt !== undefined && row.expiresAt > time;
            const result = await dependencies.database.interactivePreview.updateMany({ where: {
                id: row.id, status: row.status,
                OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: claimBefore } }],
                AND: [{ OR: [{ cleanupNextAttemptAt: null }, { cleanupNextAttemptAt: { lte: time } }] }],
                ...(stagingOnly ? { stagingCleanupPending: true } : {}),
            }, data: stagingOnly ? { cleanupClaimedAt: time } : { status: 'deleting', cleanupClaimedAt: time } });
            if (result.count === 1) {
                const claimedRow = stagingOnly ? row : { ...row, status: 'deleting' };
                claimed.push(claimedRow);
                claims.set(row.id, { status: claimedRow.status, stagingCleanupPending: Boolean(claimedRow.stagingCleanupPending) });
            }
        }
        const cleaned = await cleanupInteractivePreviewRows(claimed, {
            deleteStaging: (accountId, previewId, stagingGeneration) => dependencies.storage.deletePreview({ accountId, previewId, stagingGeneration }),
            async deleteDeployment(accountId, deploymentId) {
                const credential = await dependencies.credentialStore.get(accountId);
                if (!credential) throw new Error('Vercel credential unavailable');
                await dependencies.clientFactory({ token: credential.accessToken, teamId: credential.teamId }).deleteDeployment(deploymentId);
            },
            async markExpired(previewId) {
                await dependencies.database.interactivePreview.updateMany({ where: {
                    id: previewId, status: 'deleting', cleanupClaimedAt: time,
                }, data: {
                    status: 'expired', url: null, vercelDeploymentId: null, stagingCleanupPending: false,
                    cleanupClaimedAt: null, cleanupNextAttemptAt: null,
                } });
            },
            async markStagingClean(previewId) {
                await dependencies.database.interactivePreview.updateMany({ where: {
                    id: previewId, status: 'ready', stagingCleanupPending: true, cleanupClaimedAt: time,
                }, data: { stagingCleanupPending: false, cleanupClaimedAt: null, cleanupRetryCount: 0, cleanupNextAttemptAt: null } });
            },
            async retainForRetry(previewId) {
                const claim = claims.get(previewId);
                if (!claim) return;
                const row = await dependencies.database.interactivePreview.findFirst({ where: {
                    id: previewId, status: claim.status, cleanupClaimedAt: time,
                }, select: { cleanupRetryCount: true } }) as { cleanupRetryCount: number } | null;
                if (!row) return;
                await dependencies.database.interactivePreview.updateMany({ where: {
                    id: previewId, status: claim.status, cleanupClaimedAt: time, cleanupRetryCount: row.cleanupRetryCount,
                    ...(claim.stagingCleanupPending ? { stagingCleanupPending: true } : {}),
                }, data: {
                    cleanupClaimedAt: null, cleanupRetryCount: { increment: 1 }, cleanupNextAttemptAt: retryAt(time, row.cleanupRetryCount),
                } });
            },
        });
        await dependencies.database.interactivePreview.deleteMany({ where: {
            status: 'expired', vercelDeploymentId: null, stagingCleanupPending: false,
            updatedAt: { lte: new Date(time.getTime() - TERMINAL_RETENTION_MS) },
        } });
        return cleaned;
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
