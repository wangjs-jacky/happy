import { createHash, randomUUID } from 'node:crypto';
import { type InteractivePreviewEvent, type InteractivePreviewManifest, validateInteractivePreviewManifest } from '@slopus/happy-wire';
import { db } from '@/storage/db';
import { isLegacyPreviewStorageKey, previewStorage } from './previewStorage';
import { vercelCredentialStore, type VercelCredential } from './vercelCredentialStore';
import { createVercelClient, type VercelDeployment } from './vercelClient';

const DRAFT_TTL_MS = 60 * 60 * 1000;
const PUBLISHED_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLICATION_RECONCILE_BASE_MS = 60 * 1000;
const PUBLICATION_RECONCILE_MAX_MS = 60 * 60 * 1000;
const PUBLICATION_STALE_MS = 15 * 60 * 1000;
const VERCEL_PREVIEW_CONFIG = JSON.stringify({
    headers: [{ source: '/(.*)', headers: [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
    ] }],
});

type PreviewRow = {
    id: string; title: string; status: string; url: string | null; publishedAt: Date | null; expiresAt: Date;
    errorCode: string | null; accountId?: string; sessionId?: string | null; manifest?: unknown; stagingGeneration?: string; vercelDeploymentId?: string | null;
    publicationAttemptId?: string | null; publicationGeneration?: number; connectionGeneration?: number; stagingCleanupPending?: boolean;
    publicationCreateStartedAt?: Date | null; publicationReconcileRetryCount?: number; publicationReconcileNextAttemptAt?: Date | null; cleanupClaimedAt?: Date | null; vercelTeamId?: string | null;
    assets?: Array<{ id: string; path: string; mimeType: string; size: number; sha256: string; storageKey: string; uploadedAt: Date | null }>;
};

function canonicalManifest(rawManifest: unknown): InteractivePreviewManifest {
    const manifest = validateInteractivePreviewManifest(rawManifest);
    return {
        ...manifest,
        assets: [...manifest.assets].sort((left, right) => left.path.localeCompare(right.path) || left.id.localeCompare(right.id)),
    };
}

function manifestsMatch(left: unknown, right: InteractivePreviewManifest): boolean {
    try {
        return JSON.stringify(canonicalManifest(left)) === JSON.stringify(right);
    } catch {
        return false;
    }
}

function previewNotFound(): Error {
    return new Error('Preview not found');
}

function uniqueViolation(error: unknown): boolean {
    return (error as { code?: unknown } | null)?.code === 'P2002';
}

async function deletePersistedPreviewStaging(storage: Pick<typeof previewStorage, 'deletePreview'>, row: PreviewRow, accountId = row.accountId!): Promise<void> {
    const scope = { accountId, previewId: row.id, stagingGeneration: row.stagingGeneration! };
    const legacyStorageKeys = row.assets?.map((asset) => asset.storageKey).filter((storageKey) => isLegacyPreviewStorageKey(row.id, storageKey)) || [];
    if (legacyStorageKeys.length) await storage.deletePreview(scope, legacyStorageKeys);
    else await storage.deletePreview(scope);
}

export function previewRowToEvent(row: PreviewRow): InteractivePreviewEvent {
    const state = row.status === 'ready' ? 'ready' : row.status === 'expired' || row.status === 'deleting' ? 'expired' : row.status === 'failed' ? 'failed' : 'publishing';
    return {
        version: 1, id: row.id, title: row.title, state,
        ...(state === 'ready' && row.url ? { url: row.url } : {}),
        ...(row.publishedAt ? { publishedAt: row.publishedAt.getTime() } : {}),
        ...(row.expiresAt ? { expiresAt: row.expiresAt.getTime() } : {}),
        ...(row.errorCode ? { errorCode: row.errorCode } : {}),
    };
}

class TwoSlotGate {
    private active = 0;
    private readonly waiting: Array<() => void> = [];
    async run<T>(work: () => Promise<T>): Promise<T> {
        if (this.active >= 2) await new Promise<void>((resolve) => this.waiting.push(resolve));
        this.active++;
        try { return await work(); } finally { this.active--; this.waiting.shift()?.(); }
    }
}

const publishGate = new TwoSlotGate();

export function createPreviewService(dependencies: {
    database: typeof db;
    storage: typeof previewStorage;
    credentialStore: typeof vercelCredentialStore;
    clientFactory: typeof createVercelClient;
    now?: () => Date;
}) {
    const database = dependencies.database;
    const storage = dependencies.storage;
    const credentialStore = dependencies.credentialStore;
    const clientFactory = dependencies.clientFactory;
    const now = dependencies.now || (() => new Date());
    const publicationRetryAt = (time: Date, retryCount: number) => new Date(time.getTime() + Math.min(PUBLICATION_RECONCILE_MAX_MS, PUBLICATION_RECONCILE_BASE_MS * 2 ** Math.min(retryCount, 10)));
    const accountConnectionEpoch = async (accountId: string): Promise<number> => {
        const account = (database as any).account;
        if (!account?.findUnique) return 0;
        const row = await account.findUnique({ where: { id: accountId }, select: { vercelConnectionEpoch: true } });
        return row?.vercelConnectionEpoch ?? 0;
    };
    const connectionIsCurrent = async (accountId: string, epoch: number): Promise<boolean> =>
        await accountConnectionEpoch(accountId) === epoch;
    const sessionOwnedBy = async (accountId: string, sessionId: string): Promise<boolean> =>
        Boolean(await database.session.findFirst({ where: { id: sessionId, accountId }, select: { id: true } }));
    return {
    sessionOwnedBy,
    async createDraft(accountId: string, sessionId: string, rawManifest: InteractivePreviewManifest) {
        const manifest = canonicalManifest(rawManifest);
        if (!await sessionOwnedBy(accountId, sessionId)) throw previewNotFound();
        const existing = await database.interactivePreview.findUnique({ where: { id: manifest.previewId }, include: { assets: true } }) as PreviewRow | null;
        const describeUploads = async (row: PreviewRow) => ({
            previewId: row.id,
            uploads: await Promise.all((row.assets || []).map(async (asset) => ({ assetId: asset.id, ...await storage.createUpload(asset.storageKey, asset.size) }))),
        });
        const isReusableDraft = (row: PreviewRow): boolean => row.status === 'draft'
            && row.expiresAt > now()
            && row.cleanupClaimedAt === null;
        if (existing) {
            if (existing.accountId !== accountId || existing.sessionId !== sessionId || !manifestsMatch(existing.manifest, manifest)) throw previewNotFound();
            if (!isReusableDraft(existing)) throw previewNotFound();
            return describeUploads(existing);
        }
        const expiresAt = new Date(now().getTime() + DRAFT_TTL_MS);
        const stagingGeneration = randomUUID();
        const connectionGeneration = await accountConnectionEpoch(accountId);
        const assetRecords = manifest.assets.map((asset) => ({
            ...asset,
            storageKey: storage.storageKey({ accountId, previewId: manifest.previewId, stagingGeneration }, asset.id),
        }));
        try {
            const created = await database.interactivePreview.create({ data: {
                id: manifest.previewId, accountId, sessionId, title: manifest.title, manifest: manifest as any, expiresAt, stagingGeneration, connectionGeneration,
                assets: { create: assetRecords },
            }, include: { assets: true } }) as PreviewRow;
            return describeUploads(created);
        } catch (error) {
            if (!uniqueViolation(error)) throw error;
            const raced = await database.interactivePreview.findUnique({ where: { id: manifest.previewId }, include: { assets: true } }) as PreviewRow | null;
            if (!raced || raced.accountId !== accountId || raced.sessionId !== sessionId || !manifestsMatch(raced.manifest, manifest)) throw previewNotFound();
            if (!isReusableDraft(raced)) throw previewNotFound();
            return describeUploads(raced);
        }
    },
    async completeAsset(accountId: string, sessionId: string, previewId: string, assetId: string): Promise<void> {
        const preview = await database.interactivePreview.findFirst({ where: { id: previewId, accountId, sessionId, status: 'draft' }, include: { assets: true } });
        const asset = preview?.assets.find((candidate) => candidate.id === assetId);
        if (!asset) throw previewNotFound();
        await storage.assertUploaded(asset.storageKey, asset.size);
        await database.interactivePreviewAsset.update({ where: { previewId_id: { previewId, id: assetId } }, data: { uploadedAt: now() } });
    },
    async publish(accountId: string, sessionId: string, previewId: string): Promise<InteractivePreviewEvent> {
        const current = await database.interactivePreview.findFirst({ where: { id: previewId, accountId, sessionId }, include: { assets: true } }) as PreviewRow | null;
        if (!current) throw previewNotFound();
        if (current.status === 'ready' || current.status === 'publishing') return previewRowToEvent(current);
        if (current.status === 'failed' && current.publicationAttemptId && current.publicationCreateStartedAt) return previewRowToEvent(current);
        return publishGate.run(async () => {
            let createdDeploymentId: string | null = null;
            let publicationCreateStarted = false;
            let publicationInconclusive = false;
            let row = await database.interactivePreview.findFirst({ where: { id: previewId, accountId, sessionId }, include: { assets: true } }) as PreviewRow | null;
            if (!row) throw previewNotFound();
            if (row.status === 'ready') return previewRowToEvent(row);
            if (row.status === 'publishing') return previewRowToEvent(row);
            if (!row.assets?.length || row.assets.some((asset) => !asset.uploadedAt)) throw new Error('Preview assets are incomplete');
            if (row.assets.some((asset) => asset.path === 'vercel.json')) throw new Error('Preview manifest may not include vercel.json');
            const publicationAttemptId = randomUUID();
            const publicationGeneration = (row.publicationGeneration ?? 0) + 1;
            const connectionGeneration = row.connectionGeneration ?? 0;
            const publicationWhere = {
                id: previewId, accountId, sessionId, status: 'publishing', publicationAttemptId, publicationGeneration, connectionGeneration, cleanupClaimedAt: null,
            };
            const claimed = await database.interactivePreview.updateMany({
                where: {
                    id: previewId, accountId, sessionId, status: { in: ['draft', 'failed'] },
                    publicationGeneration: row.publicationGeneration ?? 0, connectionGeneration,
                    cleanupClaimedAt: null,
                },
                data: {
                    status: 'publishing', errorCode: null, publicationAttemptId, publicationGeneration,
                    publicationCreateStartedAt: null, publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                },
            });
            if (claimed.count !== 1) {
                row = await database.interactivePreview.findFirst({ where: { id: previewId, accountId, sessionId }, include: { assets: true } }) as PreviewRow | null;
                if (row?.status === 'ready') return previewRowToEvent(row);
                if (row?.status === 'publishing') return previewRowToEvent(row);
                throw new Error('Preview publication already in progress');
            }
            const markDeploymentObsolete = async (deploymentId: string) => {
                const obsolete = await database.interactivePreview.updateMany({ where: {
                    id: previewId, accountId, status: 'deleting', cleanupClaimedAt: null,
                    OR: [{ vercelDeploymentId: null }, { vercelDeploymentId: deploymentId }],
                }, data: { vercelDeploymentId: deploymentId } });
                return obsolete.count === 1;
            };
            const deleteUnclaimedDeployment = async (client: { deleteDeployment?: (deploymentId: string) => Promise<void> }, deploymentId: string) => {
                // A recovery claim may have observed the same deployment while this
                // publisher was delayed. It owns the live attempt; delete only after
                // a CAS proves the row has become a deleting tombstone.
                if (!await markDeploymentObsolete(deploymentId)) return;
                try {
                    await client.deleteDeployment?.(deploymentId);
                } catch {
                    const persisted = await database.interactivePreview.findFirst({ where: { id: previewId }, select: { cleanupRetryCount: true } }) as { cleanupRetryCount: number } | null;
                    await database.interactivePreview.updateMany({ where: {
                        id: previewId, accountId, publicationAttemptId, status: 'deleting', vercelDeploymentId: deploymentId,
                    }, data: {
                        errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING', cleanupRetryCount: { increment: 1 },
                        cleanupNextAttemptAt: publicationRetryAt(now(), persisted?.cleanupRetryCount ?? 0),
                    } });
                    return;
                }
                const checkpointed = await database.interactivePreview.updateMany({ where: {
                    id: previewId, accountId, status: 'deleting', publicationAttemptId, vercelDeploymentId: deploymentId,
                    cleanupClaimedAt: null,
                }, data: {
                    vercelDeploymentId: null, publicationAttemptId: null, publicationCreateStartedAt: null,
                    publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                    errorCode: 'OSS_CLEANUP_PENDING',
                } });
                if (checkpointed.count !== 1) return;
                try {
                    await deletePersistedPreviewStaging(storage, row, accountId);
                } catch {
                    const persisted = await database.interactivePreview.findFirst({ where: { id: previewId }, select: { cleanupRetryCount: true } }) as { cleanupRetryCount: number } | null;
                    await database.interactivePreview.updateMany({ where: {
                        id: previewId, accountId, status: 'deleting', vercelDeploymentId: null, publicationAttemptId: null, cleanupClaimedAt: null,
                    }, data: {
                        errorCode: 'OSS_CLEANUP_PENDING', cleanupRetryCount: { increment: 1 },
                        cleanupNextAttemptAt: publicationRetryAt(now(), persisted?.cleanupRetryCount ?? 0),
                    } });
                    return;
                }
                await database.interactivePreview.updateMany({ where: {
                    id: previewId, accountId, status: 'deleting', vercelDeploymentId: null, publicationAttemptId: null, cleanupClaimedAt: null,
                }, data: {
                    status: 'expired', url: null, stagingCleanupPending: false, errorCode: null,
                    cleanupClaimedAt: null, cleanupNextAttemptAt: null,
                } });
            };
            const bindDeployment = async (deploymentId: string): Promise<void> => {
                createdDeploymentId = deploymentId;
                const bound = await database.interactivePreview.updateMany({
                    where: { ...publicationWhere, OR: [{ vercelDeploymentId: null }, { vercelDeploymentId: deploymentId }] },
                    data: { vercelDeploymentId: deploymentId },
                });
                if (bound.count !== 1) throw new Error('Preview publication was fenced before deployment tracking');
            };
            try {
                const credential = await credentialStore.get(accountId);
                if (!credential) throw new Error('VERCEL_NOT_CONNECTED');
                if (!await connectionIsCurrent(accountId, connectionGeneration)) throw new Error('Vercel connection changed during publication');
                const scoped = await database.interactivePreview.updateMany({ where: publicationWhere, data: { vercelTeamId: credential.teamId ?? null } });
                if (scoped.count !== 1) throw new Error('Vercel connection changed during publication');
                const client = clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                const project = await client.ensurePreviewProject({
                    configurationId: credential.configurationId,
                    ...(credential.projectId ? { projectId: credential.projectId } : {}),
                });
                if (credential.projectId !== project.id) {
                    const persisted = await credentialStore.setProjectIdIfCurrent(accountId, credential, project.id);
                    if (!persisted) throw new Error('Vercel connection changed during project provisioning');
                }
                const lookup = await client.lookupDeploymentByMetadata?.({ projectId: project.id, happyPreviewId: previewId, publicationAttemptId }) ?? { visibility: 'not_found' as const };
                let deployment: VercelDeployment | null = lookup.visibility === 'not_found' ? null : lookup.deployment;
                if (deployment) {
                    try { await bindDeployment(deployment.id); }
                    catch (error) { await deleteUnclaimedDeployment(client, deployment.id); throw error; }
                }
                if (lookup.visibility === 'terminal') {
                    await database.interactivePreview.updateMany({ where: { ...publicationWhere, vercelDeploymentId: deployment?.id }, data: {
                        status: 'deleting', url: null, errorCode: 'PUBLISH_TERMINAL', cleanupClaimedAt: null,
                    } });
                    throw new Error('Vercel deployment reached a terminal state');
                }
                if (lookup.visibility === 'in_progress' && deployment) {
                    publicationInconclusive = true;
                    deployment = await client.waitForDeploymentReady?.(deployment) ?? deployment;
                }
                const files = [];
                if (!deployment) {
                    for (const asset of row.assets) {
                        const bytes = await storage.read(asset.storageKey, asset.size);
                        const digest = createHash('sha256').update(bytes).digest('hex');
                        if (digest !== asset.sha256 || bytes.length !== asset.size) throw new Error('Preview asset integrity mismatch');
                        const vercelSha = createHash('sha1').update(bytes).digest('hex');
                        await client.uploadFile(vercelSha, bytes, asset.mimeType);
                        files.push({ file: asset.path, sha: vercelSha, size: asset.size });
                    }
                    const configBytes = Buffer.from(VERCEL_PREVIEW_CONFIG);
                    const configSha = createHash('sha1').update(configBytes).digest('hex');
                    await client.uploadFile(configSha, configBytes, 'application/json');
                    files.push({ file: 'vercel.json', sha: configSha, size: configBytes.byteLength });
                    const createStarted = await database.interactivePreview.updateMany({ where: {
                        ...publicationWhere, publicationCreateStartedAt: null,
                    }, data: { publicationCreateStartedAt: now() } });
                    if (createStarted.count !== 1) throw new Error('Preview publication was fenced before deployment creation');
                    publicationCreateStarted = true;
                    publicationInconclusive = true;
                    if (!await connectionIsCurrent(accountId, connectionGeneration)) throw new Error('Vercel connection changed during deployment creation');
                    deployment = await client.createDeployment({
                        name: 'happy-previews', projectId: project.id, files,
                        meta: { happyPreviewId: previewId, happyPublicationAttemptId: publicationAttemptId },
                        onCreated: async ({ id }) => {
                            try {
                                if (!await connectionIsCurrent(accountId, connectionGeneration)) throw new Error('Vercel connection changed during deployment creation');
                                await bindDeployment(id);
                            }
                            catch (error) { await deleteUnclaimedDeployment(client, id); throw error; }
                        },
                    });
                }
                if (!deployment) throw new Error('Vercel deployment reconciliation returned no deployment');
                createdDeploymentId = deployment.id;
                if (!await connectionIsCurrent(accountId, connectionGeneration)) throw new Error('Vercel connection changed before preview readiness');
                const publishedAt = now(); const expiresAt = new Date(publishedAt.getTime() + PUBLISHED_TTL_MS);
                const readied = await database.interactivePreview.updateMany({
                    where: { ...publicationWhere, OR: [{ vercelDeploymentId: null }, { vercelDeploymentId: deployment.id }] },
                    data: {
                        status: 'ready', url: deployment.url, vercelDeploymentId: deployment.id, publishedAt, expiresAt,
                        stagingCleanupPending: true, cleanupRetryCount: 0, cleanupNextAttemptAt: null,
                    },
                });
                if (readied.count !== 1) {
                    await deleteUnclaimedDeployment(client, deployment.id);
                    throw new Error('Preview publication was fenced before becoming ready');
                }
                const updated = await database.interactivePreview.findFirst({ where: { id: previewId, accountId, sessionId } }) as PreviewRow | null;
                if (!updated) throw previewNotFound();
                try {
                    await deletePersistedPreviewStaging(storage, row, accountId);
                    await database.interactivePreview.updateMany({
                        where: { ...publicationWhere, status: 'ready', stagingCleanupPending: true },
                        data: { stagingCleanupPending: false, cleanupRetryCount: 0, cleanupNextAttemptAt: null },
                    });
                } catch { /* ready rows retain a durable, immediately due staging cleanup obligation */ }
                return previewRowToEvent(updated);
            } catch (error) {
                await database.interactivePreview.updateMany({
                    where: { ...publicationWhere, ...(createdDeploymentId ? { OR: [{ vercelDeploymentId: null }, { vercelDeploymentId: createdDeploymentId }] } : {}) },
                    data: publicationInconclusive || publicationCreateStarted
                        ? { status: 'publishing', errorCode: 'PUBLISH_RECONCILIATION_PENDING', publicationReconcileRetryCount: { increment: 1 }, publicationReconcileNextAttemptAt: now() }
                        : { status: 'failed', errorCode: 'PUBLISH_FAILED', ...(createdDeploymentId ? { vercelDeploymentId: createdDeploymentId } : {}) },
                });
                throw error;
            }
        });
    },
    async recoverStalePublications(time = now()): Promise<void> {
        const staleBefore = new Date(time.getTime() - PUBLICATION_STALE_MS);
        const handledIds: string[] = [];
        while (true) {
            const candidates = await database.interactivePreview.findMany({ where: {
                publicationAttemptId: { not: null },
                ...(handledIds.length ? { id: { notIn: handledIds } } : {}),
                OR: [
                    { status: 'publishing', OR: [
                        { updatedAt: { lte: staleBefore } },
                        { publicationReconcileNextAttemptAt: { lte: time } },
                        { expiresAt: { lte: time } },
                    ] },
                    { status: 'deleting', vercelDeploymentId: null, publicationCreateStartedAt: { not: null }, OR: [
                        { updatedAt: { lte: staleBefore } },
                        { publicationReconcileNextAttemptAt: { lte: time } },
                    ] },
                    { status: 'failed', vercelDeploymentId: null, publicationCreateStartedAt: { not: null }, OR: [
                        { updatedAt: { lte: staleBefore } },
                        { publicationReconcileNextAttemptAt: { lte: time } },
                        { expiresAt: { lte: time } },
                    ] },
                ],
                AND: [
                    { OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: staleBefore } }] },
                ],
            }, include: { assets: true }, take: 50, orderBy: { expiresAt: 'asc' } }) as PreviewRow[];
            if (!candidates.length) return;
            handledIds.push(...candidates.map((candidate) => candidate.id));

            for (const candidate of candidates) await publishGate.run(async () => {
            const attemptId = candidate.publicationAttemptId;
            if (!attemptId) return;
            const claimed = await database.interactivePreview.updateMany({ where: {
                id: candidate.id, accountId: candidate.accountId, status: candidate.status, publicationAttemptId: attemptId,
                publicationGeneration: candidate.publicationGeneration ?? 0, connectionGeneration: candidate.connectionGeneration ?? 0,
                OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: staleBefore } }],
            }, data: { cleanupClaimedAt: time } });
            if (claimed.count !== 1) return;
            if (candidate.status === 'failed') {
                await database.interactivePreview.updateMany({ where: {
                    id: candidate.id, accountId: candidate.accountId, status: 'failed', publicationAttemptId: attemptId, cleanupClaimedAt: time,
                }, data: {
                    status: 'deleting', url: null, errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING', cleanupClaimedAt: null,
                    publicationReconcileNextAttemptAt: time, cleanupNextAttemptAt: time,
                } });
                return;
            }
            if (candidate.status === 'deleting') {
                const retainDeletingAttempt = async () => {
                    const retryCount = candidate.publicationReconcileRetryCount ?? 0;
                    const retryAt = publicationRetryAt(time, retryCount);
                    await database.interactivePreview.updateMany({ where: {
                        id: candidate.id, accountId: candidate.accountId, status: 'deleting', publicationAttemptId: attemptId, cleanupClaimedAt: time,
                    }, data: {
                        errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING', cleanupClaimedAt: null,
                        publicationReconcileRetryCount: { increment: 1 }, publicationReconcileNextAttemptAt: retryAt,
                        cleanupNextAttemptAt: retryAt,
                    } });
                };
                try {
                    const credential = await credentialStore.get(candidate.accountId!);
                    if (!credential?.projectId) throw new Error('VERCEL_NOT_CONNECTED');
                    if (candidate.vercelTeamId && candidate.vercelTeamId !== credential.teamId) {
                        await retainDeletingAttempt();
                        return;
                    }
                    const client = clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                    const lookup = await client.lookupDeploymentByMetadata({ projectId: credential.projectId, happyPreviewId: candidate.id, publicationAttemptId: attemptId });
                    if (lookup.visibility === 'not_found') {
                        await retainDeletingAttempt();
                        return;
                    }
                    const bound = await database.interactivePreview.updateMany({ where: {
                        id: candidate.id, accountId: candidate.accountId, status: 'deleting', publicationAttemptId: attemptId, cleanupClaimedAt: time,
                        OR: [{ vercelDeploymentId: null }, { vercelDeploymentId: lookup.deployment.id }],
                    }, data: {
                        vercelDeploymentId: lookup.deployment.id, cleanupClaimedAt: null,
                        publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                    } });
                    if (bound.count !== 1) await retainDeletingAttempt();
                } catch {
                    await retainDeletingAttempt();
                }
                return;
            }
            const where = {
                id: candidate.id, accountId: candidate.accountId, status: 'publishing', publicationAttemptId: attemptId,
                publicationGeneration: candidate.publicationGeneration ?? 0, connectionGeneration: candidate.connectionGeneration ?? 0,
                cleanupClaimedAt: time,
            };
            const schedule = async (errorCode: string) => {
                const retryCount = candidate.publicationReconcileRetryCount ?? 0;
                await database.interactivePreview.updateMany({ where, data: time >= candidate.expiresAt
                    ? {
                        status: 'deleting', url: null, errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING', cleanupClaimedAt: null,
                        publicationReconcileRetryCount: { increment: 1 }, publicationReconcileNextAttemptAt: publicationRetryAt(time, retryCount),
                        cleanupNextAttemptAt: publicationRetryAt(time, retryCount),
                    }
                    : {
                        errorCode, cleanupClaimedAt: null, publicationReconcileRetryCount: { increment: 1 },
                        publicationReconcileNextAttemptAt: publicationRetryAt(time, retryCount),
                    },
                });
            };
            const markRecoveredDeploymentObsolete = async (deploymentId: string) => {
                // Reconciliation only owns provider compensation after the
                // publisher/recovery claim it holds has been converted into a
                // deleting tombstone.  In particular, never bind or delete a
                // deployment that another worker has already made ready.
                const obsolete = await database.interactivePreview.updateMany({ where: {
                    id: candidate.id, accountId: candidate.accountId, status: 'deleting',
                    publicationAttemptId: attemptId, cleanupClaimedAt: time,
                    OR: [{ vercelDeploymentId: null }, { vercelDeploymentId: deploymentId }],
                }, data: { vercelDeploymentId: deploymentId } });
                return obsolete.count === 1;
            };
            try {
                const credential = await credentialStore.get(candidate.accountId!);
                if (!credential) throw new Error('VERCEL_NOT_CONNECTED');
                const client = clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                const project = await client.ensurePreviewProject({ configurationId: credential.configurationId, ...(credential.projectId ? { projectId: credential.projectId } : {}) });
                if (credential.projectId !== project.id && !await credentialStore.setProjectIdIfCurrent(candidate.accountId!, credential, project.id)) {
                    throw new Error('Vercel connection changed during publication reconciliation');
                }
                const lookup = await client.lookupDeploymentByMetadata({ projectId: project.id, happyPreviewId: candidate.id, publicationAttemptId: attemptId });
                if (lookup.visibility === 'not_found') {
                    await schedule('PUBLISH_RECONCILIATION_PENDING');
                    return;
                }
                const deploymentId = lookup.deployment.id;
                const bound = await database.interactivePreview.updateMany({ where: {
                    ...where, OR: [{ vercelDeploymentId: null }, { vercelDeploymentId: deploymentId }],
                }, data: { vercelDeploymentId: deploymentId } });
                if (bound.count !== 1) {
                    await markRecoveredDeploymentObsolete(deploymentId);
                    return;
                }
                if (lookup.visibility === 'terminal') {
                    await database.interactivePreview.updateMany({ where: { ...where, vercelDeploymentId: deploymentId }, data: {
                        status: 'deleting', url: null, errorCode: 'PUBLISH_TERMINAL', cleanupClaimedAt: null, publicationReconcileNextAttemptAt: null,
                    } });
                    return;
                }
                const deployment = lookup.visibility === 'ready' ? lookup.deployment : await client.waitForDeploymentReady(lookup.deployment);
                const publishedAt = time;
                const expiresAt = new Date(publishedAt.getTime() + PUBLISHED_TTL_MS);
                const readied = await database.interactivePreview.updateMany({ where: {
                    ...where, OR: [{ vercelDeploymentId: null }, { vercelDeploymentId: deployment.id }],
                }, data: {
                    status: 'ready', url: deployment.url, vercelDeploymentId: deployment.id, publishedAt, expiresAt,
                    cleanupClaimedAt: null, stagingCleanupPending: true, cleanupRetryCount: 0, cleanupNextAttemptAt: null,
                    publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                } });
                if (readied.count !== 1) {
                    await markRecoveredDeploymentObsolete(deployment.id);
                    return;
                }
                try {
                    await deletePersistedPreviewStaging(storage, candidate);
                    await database.interactivePreview.updateMany({ where: { id: candidate.id, status: 'ready', vercelDeploymentId: deployment.id, stagingCleanupPending: true }, data: { stagingCleanupPending: false } });
                } catch { /* the ready-row staging cleanup worker retries this independently */ }
            } catch {
                await schedule('PUBLISH_RECONCILIATION_PENDING');
            }
            });
            if (candidates.length < 50) return;
        }
    },
    async list(accountId: string, sessionId: string): Promise<InteractivePreviewEvent[]> {
        const rows = await database.interactivePreview.findMany({ where: { accountId, sessionId }, orderBy: { createdAt: 'desc' }, take: 50 });
        return rows.map((row) => previewRowToEvent(row));
    },
    async delete(accountId: string, sessionId: string, previewId: string): Promise<void> {
        const row = await database.interactivePreview.findFirst({ where: { id: previewId, accountId, sessionId } }) as PreviewRow | null;
        if (!row) return;
        await database.interactivePreview.updateMany({
            where: { id: previewId, accountId, sessionId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] } },
            data: {
                status: 'deleting', url: null, errorCode: null, publicationGeneration: { increment: 1 },
                publicationReconcileNextAttemptAt: now(),
            },
        });
    },
    async disconnectVercel(accountId: string): Promise<{ warning?: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' }> {
        await database.interactivePreview.updateMany({ where: {
            accountId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] },
        }, data: {
            status: 'deleting', url: null, errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING',
            publicationGeneration: { increment: 1 }, connectionGeneration: { increment: 1 },
            publicationReconcileNextAttemptAt: now(),
        } });
        const credential = await credentialStore.get(accountId);
        const rows = await database.interactivePreview.findMany({ where: {
            accountId, status: { in: ['draft', 'publishing', 'failed', 'ready', 'deleting'] },
        }, select: { id: true, vercelDeploymentId: true, vercelTeamId: true, stagingGeneration: true, publicationAttemptId: true, publicationCreateStartedAt: true, cleanupClaimedAt: true, cleanupNextAttemptAt: true, assets: { select: { storageKey: true } } } }) as unknown as Array<PreviewRow>;
        let warning = false;
        const client = credential ? clientFactory({ token: credential.accessToken, teamId: credential.teamId }) : null;
        for (const row of rows) {
            if (row.cleanupClaimedAt) {
                warning = true;
                continue;
            }
            try {
                if (row.vercelTeamId && row.vercelTeamId !== credential?.teamId) {
                    throw new Error('Vercel credential scope no longer owns this deployment');
                }
                let deploymentId = row.vercelDeploymentId;
                if (!deploymentId && row.publicationAttemptId && credential?.projectId) {
                    const lookup = await client?.lookupDeploymentByMetadata?.({ projectId: credential.projectId, happyPreviewId: row.id, publicationAttemptId: row.publicationAttemptId });
                    deploymentId = lookup && lookup.visibility !== 'not_found' ? lookup.deployment.id : null;
                    if (deploymentId) {
                        const persisted = await database.interactivePreview.updateMany({
                            where: { id: row.id, accountId, publicationAttemptId: row.publicationAttemptId, status: 'deleting', vercelDeploymentId: null, cleanupClaimedAt: null },
                            data: { vercelDeploymentId: deploymentId },
                        });
                        if (persisted.count !== 1) throw new Error('Preview cleanup claim changed during disconnect');
                    }
                }
                if (!deploymentId && row.publicationAttemptId && row.publicationCreateStartedAt) {
                    warning = true;
                    await database.interactivePreview.updateMany({ where: {
                        id: row.id, accountId, publicationAttemptId: row.publicationAttemptId, status: 'deleting', cleanupClaimedAt: null,
                    }, data: { errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' } });
                    continue;
                }
                if (deploymentId) {
                    if (!client) throw new Error('Vercel credential unavailable');
                    await client.deleteDeployment(deploymentId);
                    const checkpointed = await database.interactivePreview.updateMany({ where: {
                        id: row.id, accountId, status: 'deleting', vercelDeploymentId: deploymentId, cleanupClaimedAt: null,
                        ...(row.publicationAttemptId ? { publicationAttemptId: row.publicationAttemptId } : {}),
                    }, data: {
                        vercelDeploymentId: null, publicationAttemptId: null, publicationCreateStartedAt: null,
                        publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                        errorCode: 'OSS_CLEANUP_PENDING',
                    } });
                    if (checkpointed.count !== 1) throw new Error('Preview provider deletion checkpoint changed during disconnect');
                    deploymentId = null;
                }
                await deletePersistedPreviewStaging(storage, row, accountId);
                const expired = await database.interactivePreview.updateMany({
                    where: { id: row.id, accountId, status: 'deleting', cleanupClaimedAt: null, vercelDeploymentId: null, publicationAttemptId: null },
                    data: { status: 'expired', url: null, vercelDeploymentId: null, stagingCleanupPending: false, errorCode: null, cleanupClaimedAt: null, cleanupNextAttemptAt: null },
                });
                if (expired.count !== 1) throw new Error('Preview cleanup claim changed during disconnect');
            } catch {
                warning = true;
                await database.interactivePreview.updateMany({ where: {
                    id: row.id, accountId, status: 'deleting', cleanupClaimedAt: null,
                }, data: { errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' } });
            }
        }
        await credentialStore.delete(accountId);
        return warning ? { warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' } : {};
    },
    async reconnectVercel(accountId: string, replacement: VercelCredential): Promise<void> {
        const previous = await credentialStore.get(accountId);
        const epoch = await (database as any).$transaction(async (transaction: any) => {
            const account = await transaction.account.update({ where: { id: accountId }, data: { vercelConnectionEpoch: { increment: 1 } }, select: { vercelConnectionEpoch: true } });
            await transaction.interactivePreview.updateMany({ where: {
                accountId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] },
            }, data: {
                status: 'deleting', url: null, errorCode: 'VERCEL_CONNECTION_REPLACED',
                connectionGeneration: account.vercelConnectionEpoch, publicationGeneration: { increment: 1 },
                publicationReconcileNextAttemptAt: now(),
            } });
            return account.vercelConnectionEpoch as number;
        });
        const sameScope = previous?.configurationId === replacement.configurationId && previous.teamId === replacement.teamId;
        await credentialStore.set(accountId, {
            ...replacement,
            ...(sameScope && previous?.projectId ? { projectId: previous.projectId } : {}),
        });
        // `epoch` is deliberately not embedded in the encrypted provider payload:
        // the Account row fences publishers while credentials remain token-only.
        void epoch;
    },
    };
}

export const previewService = createPreviewService({ database: db, storage: previewStorage, credentialStore: vercelCredentialStore, clientFactory: createVercelClient });
