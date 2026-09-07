import { db } from '@/storage/db';
import { onShutdown } from '@/utils/shutdown';
import { log } from '@/utils/log';
import { isLegacyPreviewStorageKey, previewStorage } from '@/app/previews/previewStorage';
import { cloudflareCredentialStore } from '@/app/previews/cloudflareCredentialStore';
import { createCloudflareClient } from '@/app/previews/cloudflareClient';
import { previewService } from '@/app/previews/previewService';

const CLEANUP_INTERVAL_MS = 60 * 1000;
const CLAIM_TTL_MS = 15 * 60 * 1000;
const RETRY_BASE_MS = 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;

const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function cloudflareTeamScope(teamId: string | null | undefined): string | null {
    return teamId ?? null;
}

export type CleanupPreviewRow = {
    id: string; status: string; accountId: string; stagingGeneration: string; cloudflareDeploymentId: string | null;
    stagingCleanupPending?: boolean; expiresAt?: Date; cloudflareTeamId?: string | null; cloudflareScopeKnown?: boolean;
    assets?: Array<{ storageKey: string }>;
};
export interface PreviewCleanupDependencies {
    deleteStaging(accountId: string, previewId: string, stagingGeneration: string): Promise<void>;
    deleteDeployment(accountId: string, deploymentId: string): Promise<void>;
    markProviderDeleted(previewId: string, deploymentId: string): Promise<void>;
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
            if (row.cloudflareDeploymentId) {
                await dependencies.deleteDeployment(row.accountId, row.cloudflareDeploymentId);
                await dependencies.markProviderDeleted(row.id, row.cloudflareDeploymentId);
            }
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
    credentialStore: Pick<typeof cloudflareCredentialStore, 'get'>;
    clientFactory: typeof createCloudflareClient;
    now?: () => Date;
    recoverPublications?: (time: Date) => Promise<void>;
}) {
    const now = dependencies.now ?? (() => new Date());
    const staleClaim = (time: Date) => new Date(time.getTime() - CLAIM_TTL_MS);
    const retryAt = (time: Date, retryCount: number) => new Date(time.getTime() + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(retryCount, 10)));

    async function recoverStalePublications(time: Date): Promise<void> {
        if (dependencies.recoverPublications) {
            await dependencies.recoverPublications(time);
            return;
        }
        await dependencies.database.interactivePreview.updateMany({
            where: { stagingGeneration: { startsWith: 'cf-' }, status: 'publishing', updatedAt: { lte: staleClaim(time) } },
            data: { status: 'failed', errorCode: 'PUBLISH_LEASE_EXPIRED', cleanupClaimedAt: null, cleanupNextAttemptAt: null },
        });
    }

    async function cleanupExpired(time = now()): Promise<number> {
        await recoverStalePublications(time);
        const claimBefore = staleClaim(time);
        const due = await dependencies.database.interactivePreview.findMany({
            where: { stagingGeneration: { startsWith: 'cf-' },
                OR: [
                    { status: 'deleting' },
                    { status: 'ready', stagingCleanupPending: true },
                    { status: { in: ['draft', 'failed', 'ready'] }, expiresAt: { lte: time } },
                ],
                AND: [
                    { OR: [{ publicationCreateStartedAt: null }, { cloudflareDeploymentId: { not: null } }] },
                    { OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: claimBefore } }] },
                    { OR: [{ cleanupNextAttemptAt: null }, { cleanupNextAttemptAt: { lte: time } }] },
                ],
            },
            take: 50, orderBy: { expiresAt: 'asc' },
            select: { id: true, status: true, accountId: true, stagingGeneration: true, cloudflareDeploymentId: true, cloudflareTeamId: true, cloudflareScopeKnown: true, stagingCleanupPending: true, expiresAt: true, assets: { select: { storageKey: true } } },
        }) as CleanupPreviewRow[];
        const claimed: CleanupPreviewRow[] = [];
        const claims = new Map<string, { status: string; stagingCleanupPending: boolean }>();
        for (const row of due) {
            const stagingOnly = row.status === 'ready' && row.stagingCleanupPending === true && row.expiresAt !== undefined && row.expiresAt > time;
            const result = await dependencies.database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
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
            deleteStaging: (accountId, previewId, stagingGeneration) => {
                const row = claimed.find((candidate) => candidate.id === previewId);
                const scope = { accountId, previewId, stagingGeneration };
                const legacyStorageKeys = row?.assets?.map((asset) => asset.storageKey).filter((storageKey) => isLegacyPreviewStorageKey(previewId, storageKey)) || [];
                return legacyStorageKeys.length ? dependencies.storage.deletePreview(scope, legacyStorageKeys) : dependencies.storage.deletePreview(scope);
            },
            async deleteDeployment(accountId, deploymentId) {
                const credential = await dependencies.credentialStore.get(accountId);
                if (!credential) throw new Error('Cloudflare credential unavailable');
                const row = claimed.find((candidate) => candidate.accountId === accountId && candidate.cloudflareDeploymentId === deploymentId);
                if (!row) throw new Error('Cloudflare cleanup row is unavailable');
                const client = dependencies.clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                if (row.cloudflareScopeKnown === false) {
                    // Null used to mean both “personal” and “unknown”. Only a
                    // configured team is a candidate scope for an unknown
                    // legacy row; an unscoped 404 cannot prove global absence.
                    if (!credential.teamId) throw new Error('Cloudflare legacy deployment scope is unknown');
                    const resolved = await client.resolveDeploymentScope?.(deploymentId);
                    if (!resolved || resolved.visibility === 'not_found') {
                        throw new Error('Cloudflare legacy deployment remains unresolved');
                    }
                    const provenTeamId = resolved.teamId ?? credential.teamId;
                    if (cloudflareTeamScope(provenTeamId) !== cloudflareTeamScope(credential.teamId)) {
                        throw new Error('Cloudflare credential scope cannot prove legacy deployment ownership');
                    }
                    const proven = await dependencies.database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        id: row.id, status: 'deleting', cleanupClaimedAt: now(), cloudflareDeploymentId: deploymentId, cloudflareScopeKnown: false,
                    }, data: { cloudflareTeamId: provenTeamId, cloudflareScopeKnown: true } });
                    if (proven.count !== 1) throw new Error('Cloudflare legacy scope proof lost its cleanup claim');
                }
                if (cloudflareTeamScope(row.cloudflareTeamId) !== cloudflareTeamScope(credential.teamId) && row.cloudflareScopeKnown !== false) {
                    throw new Error('Cloudflare credential scope no longer owns this deployment');
                }
                await client.deleteDeployment(deploymentId);
            },
            async markExpired(previewId) {
                await dependencies.database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: previewId, status: 'deleting', cleanupClaimedAt: time,
                }, data: {
                    status: 'expired', url: null, cloudflareDeploymentId: null, stagingCleanupPending: false,
                    publicationAttemptId: null, publicationCreateStartedAt: null,
                    publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                    errorCode: null, cleanupClaimedAt: null, cleanupNextAttemptAt: null,
                } });
            },
            async markProviderDeleted(previewId, deploymentId) {
                const claim = claims.get(previewId);
                if (!claim || claim.status !== 'deleting') throw new Error('Preview cleanup claim is unavailable');
                const checkpointed = await dependencies.database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: previewId, status: 'deleting', cleanupClaimedAt: time, cloudflareDeploymentId: deploymentId,
                }, data: {
                    cloudflareDeploymentId: null, publicationAttemptId: null, publicationCreateStartedAt: null,
                    publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                    errorCode: 'OSS_CLEANUP_PENDING',
                } });
                if (checkpointed.count !== 1) throw new Error('Preview provider deletion checkpoint lost its cleanup claim');
            },
            async markStagingClean(previewId) {
                await dependencies.database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: previewId, status: 'ready', stagingCleanupPending: true, cleanupClaimedAt: time,
                }, data: { stagingCleanupPending: false, cleanupClaimedAt: null, cleanupRetryCount: 0, cleanupNextAttemptAt: null } });
            },
            async retainForRetry(previewId) {
                const claim = claims.get(previewId);
                if (!claim) return;
                const row = await dependencies.database.interactivePreview.findFirst({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: previewId, status: claim.status, cleanupClaimedAt: time,
                }, select: { cleanupRetryCount: true } }) as { cleanupRetryCount: number } | null;
                if (!row) return;
                await dependencies.database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: previewId, status: claim.status, cleanupClaimedAt: time, cleanupRetryCount: row.cleanupRetryCount,
                    ...(claim.stagingCleanupPending ? { stagingCleanupPending: true } : {}),
                }, data: {
                    cleanupClaimedAt: null, cleanupRetryCount: { increment: 1 }, cleanupNextAttemptAt: retryAt(time, row.cleanupRetryCount),
                } });
            },
        });
        await dependencies.database.interactivePreview.deleteMany({ where: { stagingGeneration: { startsWith: 'cf-' },
            status: 'expired', cloudflareDeploymentId: null, stagingCleanupPending: false,
            updatedAt: { lte: new Date(time.getTime() - TERMINAL_RETENTION_MS) },
        } });
        return cleaned;
    }

    return { cleanupExpired, recoverStalePublications };
}

const defaultPreviewCleanup = createPreviewCleanup({
    database: db, storage: previewStorage, credentialStore: cloudflareCredentialStore, clientFactory: createCloudflareClient,
    recoverPublications: (time) => previewService.recoverStalePublications(time),
});

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
