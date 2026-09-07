import { createHash, randomUUID } from 'node:crypto';
import { type InteractivePreviewEvent, type InteractivePreviewManifest, validateInteractivePreviewManifest } from '@slopus/happy-wire';
import { db } from '@/storage/db';
import { isLegacyPreviewStorageKey, previewStorage } from '@/app/previews/previewStorage';
import { cloudflareCredentialStore, type CloudflareCredential } from '@/app/previews/cloudflareCredentialStore';
import { createCloudflareClient, type CloudflareDeployment } from '@/app/previews/cloudflareClient';

const DRAFT_TTL_MS = 60 * 60 * 1000;
const PUBLISHED_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLICATION_RECONCILE_BASE_MS = 60 * 1000;
const PUBLICATION_RECONCILE_MAX_MS = 60 * 60 * 1000;
const PUBLICATION_STALE_MS = 15 * 60 * 1000;
const CONNECTION_REPLACEMENT_STALE_MS = 15 * 60 * 1000;

function cloudflareTeamScope(teamId: string | null | undefined): string | null {
    return teamId ?? null;
}

type PreviewRow = {
    id: string; title: string; status: string; url: string | null; publishedAt: Date | null; expiresAt: Date;
    errorCode: string | null; accountId?: string; sessionId?: string | null; manifest?: unknown; stagingGeneration?: string; cloudflareDeploymentId?: string | null;
    publicationAttemptId?: string | null; publicationGeneration?: number; connectionGeneration?: number; stagingCleanupPending?: boolean;
    publicationCreateStartedAt?: Date | null; publicationReconcileRetryCount?: number; publicationReconcileNextAttemptAt?: Date | null; cleanupClaimedAt?: Date | null; cloudflareTeamId?: string | null; cloudflareScopeKnown?: boolean;
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
        version: 1, provider: 'cloudflare', mode: 'hosted', id: row.id, title: row.title, state,
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
    credentialStore: typeof cloudflareCredentialStore;
    clientFactory: typeof createCloudflareClient;
    now?: () => Date;
}) {
    const database = dependencies.database;
    const storage = dependencies.storage;
    const credentialStore = dependencies.credentialStore;
    const clientFactory = dependencies.clientFactory;
    const now = dependencies.now || (() => new Date());
    const publicationRetryAt = (time: Date, retryCount: number) => new Date(time.getTime() + Math.min(PUBLICATION_RECONCILE_MAX_MS, PUBLICATION_RECONCILE_BASE_MS * 2 ** Math.min(retryCount, 10)));
    const accountConnection = async (accountId: string): Promise<{ epoch: number; state: string; nonce: string | null; replacementId: string | null; replacementStartedAt: Date | null }> => {
        const account = (database as any).account;
        if (!account?.findUnique) return { epoch: 0, state: 'active', nonce: null, replacementId: null, replacementStartedAt: null };
        const row = await account.findUnique({ where: { id: accountId }, select: {
            cloudflareConnectionEpoch: true, cloudflareConnectionState: true, cloudflareConnectionNonce: true, cloudflareConnectionReplacementId: true, cloudflareConnectionReplacementStartedAt: true,
        } });
        return {
            epoch: row?.cloudflareConnectionEpoch ?? 0,
            state: row?.cloudflareConnectionState ?? 'active',
            nonce: row?.cloudflareConnectionNonce ?? null,
            replacementId: row?.cloudflareConnectionReplacementId ?? null,
            replacementStartedAt: row?.cloudflareConnectionReplacementStartedAt ?? null,
        };
    };
    const accountConnectionEpoch = async (accountId: string): Promise<number> => (await accountConnection(accountId)).epoch;
    const credentialMatchesConnection = (credential: CloudflareCredential, connection: Awaited<ReturnType<typeof accountConnection>>): boolean =>
        (credential.connectionEpoch ?? 0) === connection.epoch
        && (credential.connectionNonce ?? null) === connection.nonce;
    const staleConnectionCutoff = (): Date => new Date(now().getTime() - CONNECTION_REPLACEMENT_STALE_MS);
    const recoverStaleConnection = async (accountId: string, observed?: Awaited<ReturnType<typeof accountConnection>>): Promise<boolean> => {
        observed ||= await accountConnection(accountId);
        if (!['replacing', 'finalizing', 'disconnecting'].includes(observed.state) || !observed.replacementId || !observed.nonce
            || !observed.replacementStartedAt || observed.replacementStartedAt > staleConnectionCutoff()) return false;
        const recoveryNonce = randomUUID();
        const recover = async (transaction: any): Promise<boolean> => {
            const recovered = await transaction.account.updateMany({ where: {
                id: accountId, cloudflareConnectionEpoch: observed.epoch, cloudflareConnectionState: observed.state,
                cloudflareConnectionNonce: observed.nonce, cloudflareConnectionReplacementId: observed.replacementId,
                cloudflareConnectionReplacementStartedAt: { lte: staleConnectionCutoff() },
            }, data: {
                cloudflareConnectionEpoch: { increment: 1 }, cloudflareConnectionState: 'disconnected', cloudflareConnectionNonce: recoveryNonce,
                cloudflareConnectionReplacementId: null, cloudflareConnectionReplacementStartedAt: null,
            } });
            if (recovered.count !== 1) return false;
            await (credentialStore as any).deletePendingConnectionReplacementInTransaction?.(
                transaction, accountId, observed.epoch, observed.nonce,
            );
            return true;
        };
        if ((database as any).$transaction) return (database as any).$transaction(recover);
        return recover(database as any);
    };
    const activeCredential = async (accountId: string): Promise<CloudflareCredential | null> => {
        let connection = await accountConnection(accountId);
        if (await recoverStaleConnection(accountId, connection)) connection = await accountConnection(accountId);
        const credential = await credentialStore.get(accountId);
        if (!credential) return null;
        if (connection.state === 'active' && credentialMatchesConnection(credential, connection)) return credential;
        return null;
    };
    // During a reconnect/disconnect drain, the old active credential is not
    // authorized for normal work but remains the only safe cleanup credential.
    const predecessorCredential = async (accountId: string): Promise<CloudflareCredential | null> => {
        let connection = await accountConnection(accountId);
        if (await recoverStaleConnection(accountId, connection)) connection = await accountConnection(accountId);
        const credential = await credentialStore.get(accountId);
        if (!credential) return null;
        if (connection.state === 'active') return credentialMatchesConnection(credential, connection) ? credential : null;
        return credential;
    };
    const connectionIsCurrent = async (accountId: string, epoch: number): Promise<boolean> => {
        const connection = await accountConnection(accountId);
        return connection.state === 'active' && connection.epoch === epoch;
    };
    const requireActiveConnection = async (accountId: string): Promise<number> => {
        let connection = await accountConnection(accountId);
        if (await recoverStaleConnection(accountId, connection)) connection = await accountConnection(accountId);
        if (connection.state !== 'active') throw new Error('CLOUDFLARE_CONNECTION_REPLACEMENT_IN_PROGRESS');
        return connection.epoch;
    };
    const sessionOwnedBy = async (accountId: string, sessionId: string): Promise<boolean> =>
        Boolean(await database.session.findFirst({ where: { id: sessionId, accountId }, select: { id: true } }));
    return {
    sessionOwnedBy,
    getActiveCloudflareCredential: activeCredential,
    async createDraft(accountId: string, sessionId: string, rawManifest: InteractivePreviewManifest) {
        const manifest = canonicalManifest(rawManifest);
        const describeUploads = async (row: PreviewRow) => ({
            previewId: row.id,
            uploads: row.status !== 'draft' ? [] : await Promise.all((row.assets || []).map(async (asset) => ({ assetId: asset.id, ...await storage.createUpload(asset.storageKey, asset.size) }))),
        });
        const isReusableDraft = (row: PreviewRow): boolean => row.stagingGeneration?.startsWith('cf-') === true && ['draft', 'failed', 'publishing', 'ready'].includes(row.status)
            && row.expiresAt > now()
            && row.cleanupClaimedAt === null;
        const createWithinFence = async (transaction: any): Promise<PreviewRow> => {
            if (!await transaction.session.findFirst({ where: { id: sessionId, accountId }, select: { id: true } })) throw previewNotFound();
            const connection = await transaction.account?.findUnique?.({ where: { id: accountId }, select: { cloudflareConnectionEpoch: true, cloudflareConnectionState: true } });
            const epoch = connection?.cloudflareConnectionEpoch ?? 0;
            const state = connection?.cloudflareConnectionState ?? 'active';
            if (state !== 'active') throw new Error('CLOUDFLARE_CONNECTION_REPLACEMENT_IN_PROGRESS');
            if (transaction.account?.updateMany) {
                const fenced = await transaction.account.updateMany({ where: {
                    id: accountId, cloudflareConnectionEpoch: epoch, cloudflareConnectionState: 'active',
                }, data: { cloudflareConnectionEpoch: epoch } });
                if (fenced.count !== 1) throw new Error('CLOUDFLARE_CONNECTION_REPLACEMENT_IN_PROGRESS');
            }
            const existing = await transaction.interactivePreview.findUnique({ where: { id: manifest.previewId }, include: { assets: true } }) as PreviewRow | null;
            if (existing) {
                if (existing.accountId !== accountId || existing.sessionId !== sessionId || !manifestsMatch(existing.manifest, manifest)) throw previewNotFound();
                if (!isReusableDraft(existing)) throw previewNotFound();
                return existing;
            }
            const expiresAt = new Date(now().getTime() + DRAFT_TTL_MS);
            const stagingGeneration = `cf-${randomUUID()}`;
            const assetRecords = manifest.assets.map((asset) => ({
                ...asset,
                storageKey: storage.storageKey({ accountId, previewId: manifest.previewId, stagingGeneration }, asset.id),
            }));
            return transaction.interactivePreview.create({ data: {
                id: manifest.previewId, accountId, sessionId, title: manifest.title, manifest: manifest as any, expiresAt, stagingGeneration, connectionGeneration: epoch,
                assets: { create: assetRecords },
            }, include: { assets: true } }) as Promise<PreviewRow>;
        };
        try {
            const created = (database as any).$transaction
                ? await (database as any).$transaction(createWithinFence)
                : await (async () => {
                    if (!await sessionOwnedBy(accountId, sessionId)) throw previewNotFound();
                    await requireActiveConnection(accountId);
                    return createWithinFence({ ...database, session: database.session, account: undefined });
                })();
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
        const preview = await database.interactivePreview.findFirst({ where: { stagingGeneration: { startsWith: 'cf-' }, id: previewId, accountId, sessionId, status: 'draft' }, include: { assets: true } });
        const asset = preview?.assets.find((candidate) => candidate.id === assetId);
        if (!asset) throw previewNotFound();
        await storage.assertUploaded(asset.storageKey, asset.size);
        await database.interactivePreviewAsset.update({ where: { previewId_id: { previewId, id: assetId } }, data: { uploadedAt: now() } });
    },
    async publish(accountId: string, sessionId: string, previewId: string): Promise<InteractivePreviewEvent> {
        const current = await database.interactivePreview.findFirst({ where: { stagingGeneration: { startsWith: 'cf-' }, id: previewId, accountId, sessionId }, include: { assets: true } }) as PreviewRow | null;
        if (!current) throw previewNotFound();
        const activeEpoch = await requireActiveConnection(accountId);
        if (current.status === 'ready' || current.status === 'publishing') return previewRowToEvent(current);
        if (current.status === 'failed' && current.publicationAttemptId && current.publicationCreateStartedAt) return previewRowToEvent(current);
        return publishGate.run(async () => {
            let createdDeploymentId: string | null = null;
            let publicationCreateStarted = false;
            let publicationInconclusive = false;
            let row = await database.interactivePreview.findFirst({ where: { stagingGeneration: { startsWith: 'cf-' }, id: previewId, accountId, sessionId }, include: { assets: true } }) as PreviewRow | null;
            if (!row) throw previewNotFound();
            if (row.status === 'ready') return previewRowToEvent(row);
            if (row.status === 'publishing') return previewRowToEvent(row);
            if (!row.assets?.length || row.assets.some((asset) => !asset.uploadedAt)) throw new Error('Preview assets are incomplete');
            if (row.assets.some(asset => ['_worker.js', '_headers', '_redirects', '_routes.json'].includes(asset.path))) {
                throw new Error('Reserved Cloudflare configuration path');
            }
            const claimTime = now();
            const publicationAttemptId = randomUUID();
            const publicationGeneration = (row.publicationGeneration ?? 0) + 1;
            const connectionGeneration = row.connectionGeneration ?? 0;
            if (connectionGeneration !== activeEpoch) throw new Error('Cloudflare connection changed during publication');
            const publicationWhere = {
                id: previewId, accountId, sessionId, status: 'publishing', publicationAttemptId, publicationGeneration, connectionGeneration, cleanupClaimedAt: null,
            };
            const claimed = await database.interactivePreview.updateMany({
                where: { stagingGeneration: { startsWith: 'cf-' },
                    id: previewId, accountId, sessionId, status: { in: ['draft', 'failed'] },
                    publicationGeneration: row.publicationGeneration ?? 0, connectionGeneration,
                    cleanupClaimedAt: null,
                    expiresAt: { gt: claimTime },
                },
                data: {
                    status: 'publishing', errorCode: null, publicationAttemptId, publicationGeneration,
                    publicationCreateStartedAt: null, publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                },
            });
            if (claimed.count !== 1) {
                row = await database.interactivePreview.findFirst({ where: { stagingGeneration: { startsWith: 'cf-' }, id: previewId, accountId, sessionId }, include: { assets: true } }) as PreviewRow | null;
                if (row?.status === 'ready') return previewRowToEvent(row);
                if (row?.status === 'publishing') return previewRowToEvent(row);
                if (row && (row.status === 'draft' || row.status === 'failed') && row.expiresAt <= claimTime) throw new Error('Preview has expired');
                throw new Error('Preview publication already in progress');
            }
            const markDeploymentObsolete = async (deploymentId: string) => {
                const obsolete = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: previewId, accountId, status: 'deleting', cleanupClaimedAt: null,
                    OR: [{ cloudflareDeploymentId: null }, { cloudflareDeploymentId: deploymentId }],
                }, data: { cloudflareDeploymentId: deploymentId } });
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
                    const persisted = await database.interactivePreview.findFirst({ where: { stagingGeneration: { startsWith: 'cf-' }, id: previewId }, select: { cleanupRetryCount: true } }) as { cleanupRetryCount: number } | null;
                    await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        id: previewId, accountId, publicationAttemptId, status: 'deleting', cloudflareDeploymentId: deploymentId,
                    }, data: {
                        errorCode: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING', cleanupRetryCount: { increment: 1 },
                        cleanupNextAttemptAt: publicationRetryAt(now(), persisted?.cleanupRetryCount ?? 0),
                    } });
                    return;
                }
                const checkpointed = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: previewId, accountId, status: 'deleting', publicationAttemptId, cloudflareDeploymentId: deploymentId,
                    cleanupClaimedAt: null,
                }, data: {
                    cloudflareDeploymentId: null, publicationAttemptId: null, publicationCreateStartedAt: null,
                    publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                    errorCode: 'OSS_CLEANUP_PENDING',
                } });
                if (checkpointed.count !== 1) return;
                try {
                    await deletePersistedPreviewStaging(storage, row, accountId);
                } catch {
                    const persisted = await database.interactivePreview.findFirst({ where: { stagingGeneration: { startsWith: 'cf-' }, id: previewId }, select: { cleanupRetryCount: true } }) as { cleanupRetryCount: number } | null;
                    await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        id: previewId, accountId, status: 'deleting', cloudflareDeploymentId: null, publicationAttemptId: null, cleanupClaimedAt: null,
                    }, data: {
                        errorCode: 'OSS_CLEANUP_PENDING', cleanupRetryCount: { increment: 1 },
                        cleanupNextAttemptAt: publicationRetryAt(now(), persisted?.cleanupRetryCount ?? 0),
                    } });
                    return;
                }
                await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: previewId, accountId, status: 'deleting', cloudflareDeploymentId: null, publicationAttemptId: null, cleanupClaimedAt: null,
                }, data: {
                    status: 'expired', url: null, stagingCleanupPending: false, errorCode: null,
                    cleanupClaimedAt: null, cleanupNextAttemptAt: null,
                } });
            };
            const bindDeployment = async (deploymentId: string): Promise<void> => {
                createdDeploymentId = deploymentId;
                const bound = await database.interactivePreview.updateMany({
                    where: { stagingGeneration: { startsWith: 'cf-' }, ...publicationWhere, OR: [{ cloudflareDeploymentId: null }, { cloudflareDeploymentId: deploymentId }] },
                    data: { cloudflareDeploymentId: deploymentId },
                });
                if (bound.count !== 1) throw new Error('Preview publication was fenced before deployment tracking');
            };
            try {
                const credential = await activeCredential(accountId);
                if (!credential) throw new Error('CLOUDFLARE_NOT_CONNECTED');
                if (!await connectionIsCurrent(accountId, connectionGeneration)) throw new Error('Cloudflare connection changed during publication');
                const scoped = await database.interactivePreview.updateMany({ where: publicationWhere, data: { cloudflareTeamId: credential.teamId ?? null, cloudflareScopeKnown: true } });
                if (scoped.count !== 1) throw new Error('Cloudflare connection changed during publication');
                const client = clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                const project = await client.ensurePreviewProject({
                    configurationId: credential.configurationId,
                    ...(credential.projectId ? { projectId: credential.projectId } : {}),
                });
                if (credential.projectId !== project.id) {
                    const persisted = await credentialStore.setProjectIdIfCurrent(accountId, credential, project.id);
                    if (!persisted) throw new Error('Cloudflare connection changed during project provisioning');
                }
                const lookup = await client.lookupDeploymentByMetadata?.({ projectId: project.id, happyPreviewId: previewId, publicationAttemptId }) ?? { visibility: 'not_found' as const };
                let deployment: CloudflareDeployment | null = lookup.visibility === 'not_found' ? null : lookup.deployment;
                if (deployment) {
                    try { await bindDeployment(deployment.id); }
                    catch (error) { await deleteUnclaimedDeployment(client, deployment.id); throw error; }
                }
                if (lookup.visibility === 'terminal') {
                    await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' }, ...publicationWhere, cloudflareDeploymentId: deployment?.id }, data: {
                        status: 'deleting', url: null, errorCode: 'PUBLISH_TERMINAL', cleanupClaimedAt: null,
                    } });
                    throw new Error('Cloudflare deployment reached a terminal state');
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
                        const cloudflareSha = createHash('sha256').update(bytes).digest('hex');
                        await client.uploadFile(cloudflareSha, bytes, asset.mimeType);
                        files.push({ file: asset.path, sha: cloudflareSha, size: asset.size });
                    }
                    await client.prepareDeployment?.(files);
                    const createStarted = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        ...publicationWhere, publicationCreateStartedAt: null,
                    }, data: { publicationCreateStartedAt: now() } });
                    if (createStarted.count !== 1) throw new Error('Preview publication was fenced before deployment creation');
                    publicationCreateStarted = true;
                    publicationInconclusive = true;
                    if (!await connectionIsCurrent(accountId, connectionGeneration)) throw new Error('Preview publication was fenced by Cloudflare connection change during deployment creation');
                    deployment = await client.createDeployment({
                        name: 'happy-previews', projectId: project.id, files,
                        meta: { happyPreviewId: previewId, happyPublicationAttemptId: publicationAttemptId },
                        onCreated: async ({ id }) => {
                            try {
                                if (!await connectionIsCurrent(accountId, connectionGeneration)) throw new Error('Preview publication was fenced by Cloudflare connection change during deployment creation');
                                await bindDeployment(id);
                            }
                            catch (error) { await deleteUnclaimedDeployment(client, id); throw error; }
                        },
                    });
                }
                if (!deployment) throw new Error('Cloudflare deployment reconciliation returned no deployment');
                createdDeploymentId = deployment.id;
                if (!await connectionIsCurrent(accountId, connectionGeneration)) throw new Error('Cloudflare connection changed before preview readiness');
                const publishedAt = now(); const expiresAt = new Date(publishedAt.getTime() + PUBLISHED_TTL_MS);
                const readied = await database.interactivePreview.updateMany({
                    where: { stagingGeneration: { startsWith: 'cf-' }, ...publicationWhere, OR: [{ cloudflareDeploymentId: null }, { cloudflareDeploymentId: deployment.id }] },
                    data: {
                        status: 'ready', url: deployment.url, cloudflareDeploymentId: deployment.id, publishedAt, expiresAt,
                        stagingCleanupPending: true, cleanupRetryCount: 0, cleanupNextAttemptAt: null,
                    },
                });
                if (readied.count !== 1) {
                    await deleteUnclaimedDeployment(client, deployment.id);
                    throw new Error('Preview publication was fenced before becoming ready');
                }
                const updated = await database.interactivePreview.findFirst({ where: { stagingGeneration: { startsWith: 'cf-' }, id: previewId, accountId, sessionId } }) as PreviewRow | null;
                if (!updated) throw previewNotFound();
                try {
                    await deletePersistedPreviewStaging(storage, row, accountId);
                    await database.interactivePreview.updateMany({
                        where: { stagingGeneration: { startsWith: 'cf-' }, ...publicationWhere, status: 'ready', stagingCleanupPending: true },
                        data: { stagingCleanupPending: false, cleanupRetryCount: 0, cleanupNextAttemptAt: null },
                    });
                } catch { /* ready rows retain a durable, immediately due staging cleanup obligation */ }
                return previewRowToEvent(updated);
            } catch (error) {
                await database.interactivePreview.updateMany({
                    where: { stagingGeneration: { startsWith: 'cf-' }, ...publicationWhere, ...(createdDeploymentId ? { OR: [{ cloudflareDeploymentId: null }, { cloudflareDeploymentId: createdDeploymentId }] } : {}) },
                    data: publicationInconclusive || publicationCreateStarted
                        ? { status: 'publishing', errorCode: 'PUBLISH_RECONCILIATION_PENDING', publicationReconcileRetryCount: { increment: 1 }, publicationReconcileNextAttemptAt: now() }
                        : { status: 'failed', errorCode: 'PUBLISH_FAILED', ...(createdDeploymentId ? { cloudflareDeploymentId: createdDeploymentId } : {}) },
                });
                throw error;
            }
        });
    },
    async recoverStalePublications(time = now()): Promise<void> {
        const staleBefore = new Date(time.getTime() - PUBLICATION_STALE_MS);
        const handledIds: string[] = [];
        while (true) {
            const candidates = await database.interactivePreview.findMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                publicationAttemptId: { not: null },
                ...(handledIds.length ? { id: { notIn: handledIds } } : {}),
                OR: [
                    { status: 'publishing', OR: [
                        { updatedAt: { lte: staleBefore } },
                        { publicationReconcileNextAttemptAt: { lte: time } },
                        { expiresAt: { lte: time } },
                    ] },
                    { status: 'deleting', cloudflareDeploymentId: null, publicationCreateStartedAt: { not: null }, OR: [
                        { updatedAt: { lte: staleBefore } },
                        { publicationReconcileNextAttemptAt: { lte: time } },
                    ] },
                    { status: 'failed', cloudflareDeploymentId: null, publicationCreateStartedAt: { not: null }, OR: [
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
            const claimed = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                id: candidate.id, accountId: candidate.accountId, status: candidate.status, publicationAttemptId: attemptId,
                publicationGeneration: candidate.publicationGeneration ?? 0, connectionGeneration: candidate.connectionGeneration ?? 0,
                OR: [{ cleanupClaimedAt: null }, { cleanupClaimedAt: { lte: staleBefore } }],
            }, data: { cleanupClaimedAt: time } });
            if (claimed.count !== 1) return;
            if (candidate.status === 'failed') {
                await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: candidate.id, accountId: candidate.accountId, status: 'failed', publicationAttemptId: attemptId, cleanupClaimedAt: time,
                }, data: {
                    status: 'deleting', url: null, errorCode: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING', cleanupClaimedAt: null,
                    publicationReconcileNextAttemptAt: time, cleanupNextAttemptAt: time,
                } });
                return;
            }
            if (candidate.status === 'deleting') {
                const retainDeletingAttempt = async () => {
                    const retryCount = candidate.publicationReconcileRetryCount ?? 0;
                    const retryAt = publicationRetryAt(time, retryCount);
                    await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        id: candidate.id, accountId: candidate.accountId, status: 'deleting', publicationAttemptId: attemptId, cleanupClaimedAt: time,
                    }, data: {
                        errorCode: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING', cleanupClaimedAt: null,
                        publicationReconcileRetryCount: { increment: 1 }, publicationReconcileNextAttemptAt: retryAt,
                        cleanupNextAttemptAt: retryAt,
                    } });
                };
                try {
                    const credential = await activeCredential(candidate.accountId!);
                    if (!credential?.projectId) throw new Error('CLOUDFLARE_NOT_CONNECTED');
                    if (candidate.cloudflareScopeKnown === false) {
                        if (!candidate.cloudflareDeploymentId) {
                            await retainDeletingAttempt();
                            return;
                        }
                        if (!credential.teamId) {
                            await retainDeletingAttempt();
                            return;
                        }
                        const candidateClient = clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                        const resolved = await candidateClient.resolveDeploymentScope?.(candidate.cloudflareDeploymentId);
                        if (!resolved) {
                            await retainDeletingAttempt();
                            return;
                        }
                        if (resolved.visibility === 'not_found') {
                            await retainDeletingAttempt();
                            return;
                        }
                        const provenTeamId = resolved.teamId ?? credential.teamId;
                        if (cloudflareTeamScope(provenTeamId) !== cloudflareTeamScope(credential.teamId)) {
                            await retainDeletingAttempt();
                            return;
                        }
                        const proven = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                            id: candidate.id, accountId: candidate.accountId, status: 'deleting', publicationAttemptId: attemptId,
                            cleanupClaimedAt: time, cloudflareDeploymentId: candidate.cloudflareDeploymentId, cloudflareScopeKnown: false,
                        }, data: { cloudflareTeamId: provenTeamId, cloudflareScopeKnown: true } });
                        if (proven.count !== 1) { await retainDeletingAttempt(); return; }
                        candidate.cloudflareTeamId = provenTeamId;
                        candidate.cloudflareScopeKnown = true;
                    }
                    if (cloudflareTeamScope(candidate.cloudflareTeamId) !== cloudflareTeamScope(credential.teamId)) {
                        await retainDeletingAttempt();
                        return;
                    }
                    const client = clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                    const lookup = await client.lookupDeploymentByMetadata({ projectId: credential.projectId, happyPreviewId: candidate.id, publicationAttemptId: attemptId });
                    if (lookup.visibility === 'not_found') {
                        await retainDeletingAttempt();
                        return;
                    }
                    const bound = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        id: candidate.id, accountId: candidate.accountId, status: 'deleting', publicationAttemptId: attemptId, cleanupClaimedAt: time,
                        OR: [{ cloudflareDeploymentId: null }, { cloudflareDeploymentId: lookup.deployment.id }],
                    }, data: {
                        cloudflareDeploymentId: lookup.deployment.id, cleanupClaimedAt: null,
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
                        status: 'deleting', url: null, errorCode: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING', cleanupClaimedAt: null,
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
                const obsolete = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: candidate.id, accountId: candidate.accountId, status: 'deleting',
                    publicationAttemptId: attemptId, cleanupClaimedAt: time,
                    OR: [{ cloudflareDeploymentId: null }, { cloudflareDeploymentId: deploymentId }],
                }, data: { cloudflareDeploymentId: deploymentId } });
                return obsolete.count === 1;
            };
            try {
                if (!await connectionIsCurrent(candidate.accountId!, candidate.connectionGeneration ?? 0)) {
                    await schedule('PUBLISH_RECONCILIATION_PENDING');
                    return;
                }
                if (candidate.cloudflareScopeKnown === false) {
                    await schedule('PUBLISH_RECONCILIATION_PENDING');
                    return;
                }
                const credential = await activeCredential(candidate.accountId!);
                if (!credential) throw new Error('CLOUDFLARE_NOT_CONNECTED');
                const client = clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                const project = await client.ensurePreviewProject({ configurationId: credential.configurationId, ...(credential.projectId ? { projectId: credential.projectId } : {}) });
                if (credential.projectId !== project.id && !await credentialStore.setProjectIdIfCurrent(candidate.accountId!, credential, project.id)) {
                    throw new Error('Cloudflare connection changed during publication reconciliation');
                }
                const lookup = await client.lookupDeploymentByMetadata({ projectId: project.id, happyPreviewId: candidate.id, publicationAttemptId: attemptId });
                if (lookup.visibility === 'not_found') {
                    await schedule('PUBLISH_RECONCILIATION_PENDING');
                    return;
                }
                const deploymentId = lookup.deployment.id;
                const bound = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    ...where, OR: [{ cloudflareDeploymentId: null }, { cloudflareDeploymentId: deploymentId }],
                }, data: { cloudflareDeploymentId: deploymentId } });
                if (bound.count !== 1) {
                    await markRecoveredDeploymentObsolete(deploymentId);
                    return;
                }
                if (lookup.visibility === 'terminal') {
                    await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' }, ...where, cloudflareDeploymentId: deploymentId }, data: {
                        status: 'deleting', url: null, errorCode: 'PUBLISH_TERMINAL', cleanupClaimedAt: null, publicationReconcileNextAttemptAt: null,
                    } });
                    return;
                }
                const deployment = lookup.visibility === 'ready' ? lookup.deployment : await client.waitForDeploymentReady(lookup.deployment);
                const publishedAt = time;
                const expiresAt = new Date(publishedAt.getTime() + PUBLISHED_TTL_MS);
                const readied = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    ...where, OR: [{ cloudflareDeploymentId: null }, { cloudflareDeploymentId: deployment.id }],
                }, data: {
                    status: 'ready', url: deployment.url, cloudflareDeploymentId: deployment.id, publishedAt, expiresAt,
                    cleanupClaimedAt: null, stagingCleanupPending: true, cleanupRetryCount: 0, cleanupNextAttemptAt: null,
                    publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                } });
                if (readied.count !== 1) {
                    await markRecoveredDeploymentObsolete(deployment.id);
                    return;
                }
                try {
                    await deletePersistedPreviewStaging(storage, candidate);
                    await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' }, id: candidate.id, status: 'ready', cloudflareDeploymentId: deployment.id, stagingCleanupPending: true }, data: { stagingCleanupPending: false } });
                } catch { /* the ready-row staging cleanup worker retries this independently */ }
            } catch {
                await schedule('PUBLISH_RECONCILIATION_PENDING');
            }
            });
            if (candidates.length < 50) return;
        }
    },
    async list(accountId: string, sessionId: string): Promise<InteractivePreviewEvent[]> {
        const rows = await database.interactivePreview.findMany({ where: { stagingGeneration: { startsWith: 'cf-' }, accountId, sessionId }, orderBy: { createdAt: 'desc' }, take: 50 });
        return rows.map((row) => previewRowToEvent(row));
    },
    async delete(accountId: string, sessionId: string, previewId: string): Promise<void> {
        const row = await database.interactivePreview.findFirst({ where: { stagingGeneration: { startsWith: 'cf-' }, id: previewId, accountId, sessionId } }) as PreviewRow | null;
        if (!row) return;
        await database.interactivePreview.updateMany({
            where: { stagingGeneration: { startsWith: 'cf-' }, id: previewId, accountId, sessionId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] } },
            data: {
                status: 'deleting', url: null, errorCode: null, publicationGeneration: { increment: 1 },
                publicationReconcileNextAttemptAt: now(),
            },
        });
    },
    async disconnectCloudflare(accountId: string): Promise<{ warning?: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' }> {
        const disconnectId = randomUUID();
        let expectedConnection = await accountConnection(accountId);
        if (await recoverStaleConnection(accountId, expectedConnection)) expectedConnection = await accountConnection(accountId);
        const usesTransactionalTransition = Boolean((credentialStore as any).beginConnectionTransitionInTransaction);
        const legacyCredential = usesTransactionalTransition ? null : await predecessorCredential(accountId);
        const beginDisconnect = async (transaction: any): Promise<{ epoch: number; predecessor: CloudflareCredential | null } | null> => {
            if (usesTransactionalTransition && transaction.account?.updateMany) {
                const transition = await (credentialStore as any).beginConnectionTransitionInTransaction(
                    transaction, accountId, expectedConnection, 'disconnecting', disconnectId, now(),
                );
                if (!transition) return null;
                await transaction.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    accountId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] },
                }, data: {
                    status: 'deleting', url: null, errorCode: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING',
                    publicationGeneration: { increment: 1 }, connectionGeneration: transition.epoch,
                    publicationReconcileNextAttemptAt: now(), cleanupNextAttemptAt: now(),
                } });
                return transition;
            }
            if (!transaction.account?.update) {
                await transaction.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    accountId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] },
                }, data: {
                    status: 'deleting', url: null, errorCode: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING',
                    publicationGeneration: { increment: 1 }, connectionGeneration: { increment: 1 }, publicationReconcileNextAttemptAt: now(),
                } });
                return { epoch: 0, predecessor: legacyCredential };
            }
            const account = await transaction.account.update({ where: { id: accountId }, data: {
                cloudflareConnectionEpoch: { increment: 1 }, cloudflareConnectionState: 'disconnecting', cloudflareConnectionNonce: disconnectId,
                cloudflareConnectionReplacementId: disconnectId, cloudflareConnectionReplacementStartedAt: now(),
            }, select: { cloudflareConnectionEpoch: true } });
            await transaction.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                accountId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] },
            }, data: {
                status: 'deleting', url: null, errorCode: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING',
                publicationGeneration: { increment: 1 }, connectionGeneration: account.cloudflareConnectionEpoch,
                publicationReconcileNextAttemptAt: now(), cleanupNextAttemptAt: now(),
            } });
            return { epoch: account.cloudflareConnectionEpoch, predecessor: legacyCredential };
        };
        const transition = (database as any).$transaction
            ? await (database as any).$transaction(beginDisconnect)
            : await beginDisconnect({ ...database, account: undefined });
        if (!transition) throw new Error('CLOUDFLARE_CONNECTION_REPLACEMENT_SUPERSEDED');
        const disconnectEpoch = transition.epoch;
        const credential = transition.predecessor;
        const disconnectOwnsConnection = async (): Promise<boolean> => {
            if (!(database as any).account?.findUnique) return true;
            const connection = await accountConnection(accountId);
            return connection.state === 'disconnecting' && connection.nonce === disconnectId && connection.replacementId === disconnectId;
        };
        const rows = await database.interactivePreview.findMany({ where: { stagingGeneration: { startsWith: 'cf-' },
            accountId, status: { in: ['draft', 'publishing', 'failed', 'ready', 'deleting'] },
        }, select: { id: true, cloudflareDeploymentId: true, cloudflareTeamId: true, cloudflareScopeKnown: true, stagingGeneration: true, publicationAttemptId: true, publicationCreateStartedAt: true, cleanupClaimedAt: true, cleanupNextAttemptAt: true, assets: { select: { storageKey: true } } } }) as unknown as Array<PreviewRow>;
        let warning = false;
        const client = credential ? clientFactory({ token: credential.accessToken, teamId: credential.teamId }) : null;
        for (const row of rows) {
            if (!await disconnectOwnsConnection()) { warning = true; break; }
            if (row.cleanupClaimedAt) {
                warning = true;
                continue;
            }
            try {
                let deploymentId = row.cloudflareDeploymentId;
                let provenScope = row.cloudflareTeamId;
                if (row.cloudflareScopeKnown === false && deploymentId) {
                    if (!credential?.teamId) throw new Error('Cloudflare legacy deployment scope is unknown');
                    const resolved = await client?.resolveDeploymentScope?.(deploymentId);
                    if (!resolved) throw new Error('Cloudflare legacy deployment scope is unavailable');
                    if (resolved.visibility === 'not_found') {
                        throw new Error('Cloudflare legacy deployment remains unresolved');
                    } else {
                        provenScope = resolved.teamId ?? credential.teamId;
                        if (cloudflareTeamScope(provenScope) !== cloudflareTeamScope(credential?.teamId)) throw new Error('Cloudflare credential cannot prove legacy deployment ownership');
                        const proven = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                            id: row.id, accountId, status: 'deleting', cloudflareDeploymentId: deploymentId, cleanupClaimedAt: null, cloudflareScopeKnown: false,
                        }, data: { cloudflareTeamId: provenScope, cloudflareScopeKnown: true } });
                        if (proven.count !== 1) throw new Error('Legacy Cloudflare scope proof changed during disconnect');
                    }
                }
                if (row.cloudflareScopeKnown === false && !deploymentId && row.publicationAttemptId) {
                    throw new Error('Legacy Cloudflare attempt scope cannot be proven');
                }
                if (cloudflareTeamScope(provenScope) !== cloudflareTeamScope(credential?.teamId) && (deploymentId || row.publicationAttemptId)) {
                    throw new Error('Cloudflare credential scope no longer owns this deployment');
                }
                if (!deploymentId && row.publicationAttemptId && credential?.projectId) {
                    const lookup = await client?.lookupDeploymentByMetadata?.({ projectId: credential.projectId, happyPreviewId: row.id, publicationAttemptId: row.publicationAttemptId });
                    deploymentId = lookup && lookup.visibility !== 'not_found' ? lookup.deployment.id : null;
                    if (deploymentId) {
                        const persisted = await database.interactivePreview.updateMany({
                            where: { stagingGeneration: { startsWith: 'cf-' }, id: row.id, accountId, publicationAttemptId: row.publicationAttemptId, status: 'deleting', cloudflareDeploymentId: null, cleanupClaimedAt: null },
                            data: { cloudflareDeploymentId: deploymentId },
                        });
                        if (persisted.count !== 1) throw new Error('Preview cleanup claim changed during disconnect');
                    }
                }
                if (!deploymentId && row.publicationAttemptId && row.publicationCreateStartedAt) {
                    warning = true;
                    await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        id: row.id, accountId, publicationAttemptId: row.publicationAttemptId, status: 'deleting', cleanupClaimedAt: null,
                    }, data: { errorCode: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' } });
                    continue;
                }
                if (deploymentId) {
                    if (!client) throw new Error('Cloudflare credential unavailable');
                    await client.deleteDeployment(deploymentId);
                    const checkpointed = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        id: row.id, accountId, status: 'deleting', cloudflareDeploymentId: deploymentId, cleanupClaimedAt: null,
                        ...(row.publicationAttemptId ? { publicationAttemptId: row.publicationAttemptId } : {}),
                    }, data: {
                        cloudflareDeploymentId: null, publicationAttemptId: null, publicationCreateStartedAt: null,
                        publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                        errorCode: 'OSS_CLEANUP_PENDING',
                    } });
                    if (checkpointed.count !== 1) throw new Error('Preview provider deletion checkpoint changed during disconnect');
                    deploymentId = null;
                }
                await deletePersistedPreviewStaging(storage, row, accountId);
                const expired = await database.interactivePreview.updateMany({
                    where: { stagingGeneration: { startsWith: 'cf-' }, id: row.id, accountId, status: 'deleting', cleanupClaimedAt: null, cloudflareDeploymentId: null, publicationAttemptId: null },
                    data: { status: 'expired', url: null, cloudflareDeploymentId: null, stagingCleanupPending: false, errorCode: null, cleanupClaimedAt: null, cleanupNextAttemptAt: null },
                });
                if (expired.count !== 1) throw new Error('Preview cleanup claim changed during disconnect');
            } catch {
                warning = true;
                await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    id: row.id, accountId, status: 'deleting', cleanupClaimedAt: null,
                }, data: { errorCode: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' } });
            }
        }
        if ((credentialStore as any).disconnectConnectionInTransaction && (database as any).$transaction) {
            const disconnected = await (database as any).$transaction((transaction: any) =>
                (credentialStore as any).disconnectConnectionInTransaction(transaction, accountId, disconnectEpoch, disconnectId, credential),
            );
            if (!disconnected) warning = true;
        } else {
            if ((credentialStore as any).deleteAtOrBeforeConnectionEpoch) {
                await (credentialStore as any).deleteAtOrBeforeConnectionEpoch(accountId, disconnectEpoch);
            } else {
                await credentialStore.delete(accountId);
            }
            if ((database as any).account?.updateMany) {
                const disconnected = await (database as any).account.updateMany({ where: {
                    id: accountId, cloudflareConnectionEpoch: disconnectEpoch, cloudflareConnectionState: 'disconnecting', cloudflareConnectionNonce: disconnectId,
                    cloudflareConnectionReplacementId: disconnectId,
                }, data: {
                    cloudflareConnectionState: 'disconnected', cloudflareConnectionReplacementId: null, cloudflareConnectionReplacementStartedAt: null,
                } });
                if (disconnected.count !== 1) warning = true;
            }
        }
        return warning ? { warning: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' } : {};
    },
    async reconnectCloudflare(accountId: string, replacement: CloudflareCredential): Promise<void> {
        let expectedConnection = await accountConnection(accountId);
        if (await recoverStaleConnection(accountId, expectedConnection)) expectedConnection = await accountConnection(accountId);
        const replacementId = randomUUID();
        const usesTransactionalTransition = Boolean((credentialStore as any).beginConnectionTransitionInTransaction);
        const legacyPrevious = usesTransactionalTransition ? null : await predecessorCredential(accountId);
        const beginReconnect = async (transaction: any): Promise<{ epoch: number; predecessor: CloudflareCredential | null; sameScope: boolean } | null> => {
            if (usesTransactionalTransition && transaction.account?.updateMany) {
                const transition = await (credentialStore as any).beginConnectionTransitionInTransaction(
                    transaction, accountId, expectedConnection, 'replacing', replacementId, now(),
                );
                if (!transition) return null;
                const sameScope = transition.predecessor !== null
                    && transition.predecessor.configurationId === replacement.configurationId
                    && cloudflareTeamScope(transition.predecessor.teamId) === cloudflareTeamScope(replacement.teamId);
                if (!sameScope && transition.predecessor) {
                    await transaction.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        accountId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] },
                    }, data: {
                        status: 'deleting', url: null, errorCode: 'CLOUDFLARE_CONNECTION_REPLACED',
                        connectionGeneration: transition.epoch, publicationGeneration: { increment: 1 },
                        publicationReconcileNextAttemptAt: now(),
                    } });
                }
                if (sameScope) {
                    // Drafts have no provider side effect yet, so they advance to
                    // the new epoch and remain publishable.  A provider create is
                    // never replayed with a replacement credential: publishing
                    // attempts become durable tombstones for reconciliation.
                    await transaction.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        accountId, status: { in: ['draft', 'uploading', 'failed', 'ready'] },
                    }, data: { connectionGeneration: transition.epoch } });
                    await transaction.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        accountId, status: 'publishing',
                    }, data: {
                        status: 'deleting', url: null, errorCode: 'CLOUDFLARE_CONNECTION_REPLACED',
                        connectionGeneration: transition.epoch, publicationGeneration: { increment: 1 },
                        publicationReconcileNextAttemptAt: now(), cleanupNextAttemptAt: now(),
                    } });
                }
                return { ...transition, sameScope };
            }
            const account = await transaction.account.update({
                where: { id: accountId },
                data: {
                    cloudflareConnectionEpoch: { increment: 1 },
                    cloudflareConnectionState: 'replacing', cloudflareConnectionNonce: replacementId,
                    cloudflareConnectionReplacementId: replacementId, cloudflareConnectionReplacementStartedAt: now(),
                },
                select: { cloudflareConnectionEpoch: true },
            });
            const sameScope = legacyPrevious !== null
                && legacyPrevious.configurationId === replacement.configurationId
                && cloudflareTeamScope(legacyPrevious.teamId) === cloudflareTeamScope(replacement.teamId);
            if (!sameScope && legacyPrevious) {
                await transaction.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    accountId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] },
                }, data: {
                    status: 'deleting', url: null, errorCode: 'CLOUDFLARE_CONNECTION_REPLACED',
                    connectionGeneration: account.cloudflareConnectionEpoch, publicationGeneration: { increment: 1 },
                    publicationReconcileNextAttemptAt: now(),
                } });
            }
            if (sameScope) {
                // Drafts have no provider side effect yet, so they advance to
                // the new epoch and remain publishable.  A provider create is
                // never replayed with a replacement credential: publishing
                // attempts become durable tombstones for reconciliation.
                await transaction.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    accountId, status: { in: ['draft', 'uploading', 'failed', 'ready'] },
                }, data: { connectionGeneration: account.cloudflareConnectionEpoch } });
                await transaction.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    accountId, status: 'publishing',
                }, data: {
                    status: 'deleting', url: null, errorCode: 'CLOUDFLARE_CONNECTION_REPLACED',
                    connectionGeneration: account.cloudflareConnectionEpoch, publicationGeneration: { increment: 1 },
                    publicationReconcileNextAttemptAt: now(), cleanupNextAttemptAt: now(),
                } });
            }
            return { epoch: account.cloudflareConnectionEpoch as number, predecessor: legacyPrevious, sameScope };
        };
        const began = (database as any).$transaction
            ? await (database as any).$transaction(beginReconnect)
            : await beginReconnect({ ...database, account: undefined });
        if (!began) throw new Error('CLOUDFLARE_CONNECTION_REPLACEMENT_SUPERSEDED');
        const { epoch, predecessor: previous, sameScope } = began;
        const replacementOwnsConnection = async (): Promise<boolean> => {
            const connection = await accountConnection(accountId);
            return connection.replacementId === replacementId
                && connection.nonce === replacementId
                && (connection.state === 'replacing' || connection.state === 'finalizing');
        };
        const renewReplacementLease = async (): Promise<void> => {
            const renewed = await (database as any).account.updateMany({ where: {
                id: accountId, cloudflareConnectionNonce: replacementId,
                cloudflareConnectionReplacementId: replacementId, cloudflareConnectionState: { in: ['replacing', 'finalizing'] },
            }, data: { cloudflareConnectionReplacementStartedAt: now() } });
            if (renewed.count !== 1) await replacementSuperseded();
        };
        const rollbackReplacement = async (): Promise<void> => {
            await (database as any).account.updateMany({ where: {
                id: accountId, cloudflareConnectionReplacementId: replacementId, cloudflareConnectionNonce: replacementId,
            }, data: {
                cloudflareConnectionState: 'disconnected', cloudflareConnectionReplacementId: null, cloudflareConnectionReplacementStartedAt: null,
            } });
        };
        const replacementCleanupFailed = async (): Promise<never> => {
            await (database as any).interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                accountId, status: 'deleting', cleanupClaimedAt: null,
            }, data: { errorCode: 'CLOUDFLARE_CONNECTION_REPLACEMENT_CLEANUP_PENDING' } });
            await rollbackReplacement();
            throw new Error('CLOUDFLARE_CONNECTION_REPLACEMENT_CLEANUP_PENDING');
        };
        const replacementSuperseded = async (): Promise<never> => {
            await (credentialStore as any).deletePendingConnectionReplacement?.(accountId, epoch, replacementId).catch(() => undefined);
            await rollbackReplacement();
            throw new Error('CLOUDFLARE_CONNECTION_REPLACEMENT_SUPERSEDED');
        };

        try {
            if (!sameScope && previous) {
                const rows = await database.interactivePreview.findMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                    accountId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready', 'deleting'] },
                }, select: {
                    id: true, accountId: true, status: true, cloudflareDeploymentId: true, cloudflareTeamId: true, cloudflareScopeKnown: true,
                    stagingGeneration: true, publicationAttemptId: true, publicationCreateStartedAt: true,
                    cleanupClaimedAt: true, assets: { select: { storageKey: true } },
                } }) as PreviewRow[];
                let client: ReturnType<typeof createCloudflareClient> | null = null;
                const oldClient = () => client ||= clientFactory({ token: previous.accessToken, teamId: previous.teamId });
                for (const row of rows) {
                    await renewReplacementLease();
                    if (row.cleanupClaimedAt) throw new Error('Preview cleanup is already claimed');
                    let deploymentId = row.cloudflareDeploymentId;
                    const unresolved = Boolean(row.publicationAttemptId && row.publicationCreateStartedAt && !deploymentId);
                    const providerBound = Boolean(deploymentId || unresolved);
                    let provenScope = row.cloudflareTeamId;
                    if (row.cloudflareScopeKnown === false) {
                        if (!deploymentId) throw new Error('Old Cloudflare scope cannot be proven');
                        if (!previous.teamId) throw new Error('Old Cloudflare scope cannot be proven');
                        const resolved = await oldClient().resolveDeploymentScope?.(deploymentId);
                        if (!resolved) throw new Error('Old Cloudflare scope resolver is unavailable');
                        if (resolved.visibility === 'not_found') {
                            throw new Error('Old Cloudflare deployment remains unresolved');
                        } else {
                            provenScope = resolved.teamId ?? previous.teamId;
                            if (cloudflareTeamScope(provenScope) !== cloudflareTeamScope(previous.teamId)) throw new Error('Old Cloudflare scope cannot be proven');
                            const proven = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                                id: row.id, accountId, status: 'deleting', cloudflareDeploymentId: deploymentId, cleanupClaimedAt: null, cloudflareScopeKnown: false,
                            }, data: { cloudflareTeamId: provenScope, cloudflareScopeKnown: true } });
                            if (proven.count !== 1) throw new Error('Old Cloudflare scope proof lost its tombstone');
                        }
                    }
                    // Exact equality deliberately treats null as the personal
                    // scope. A team credential may never delete a legacy/null
                    // personal deployment, nor vice versa.
                    if (providerBound && deploymentId && cloudflareTeamScope(provenScope) !== cloudflareTeamScope(previous.teamId)) {
                        throw new Error('Old Cloudflare scope cannot be proven');
                    }
                    if (unresolved) {
                        if (!previous.projectId) throw new Error('Old Cloudflare project is unavailable for reconciliation');
                        const lookup = await oldClient().lookupDeploymentByMetadata({
                            projectId: previous.projectId, happyPreviewId: row.id, publicationAttemptId: row.publicationAttemptId!,
                        });
                        // A create request that is not yet visible remains
                        // externally ambiguous. Retain old credentials rather
                        // than risk an orphan in the new provider scope.
                        if (lookup.visibility === 'not_found') throw new Error('Old Cloudflare deployment is unresolved');
                        deploymentId = lookup.deployment.id;
                        const bound = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                            id: row.id, accountId, status: 'deleting', publicationAttemptId: row.publicationAttemptId,
                            cloudflareDeploymentId: null, cleanupClaimedAt: null,
                        }, data: { cloudflareDeploymentId: deploymentId } });
                        if (bound.count !== 1) throw new Error('Old Cloudflare deployment reconciliation lost its tombstone');
                    }
                    if (deploymentId) {
                        await renewReplacementLease();
                        await oldClient().deleteDeployment(deploymentId);
                        const checkpointed = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                            id: row.id, accountId, status: 'deleting', cloudflareDeploymentId: deploymentId,
                            cleanupClaimedAt: null,
                            ...(row.publicationAttemptId ? { publicationAttemptId: row.publicationAttemptId } : {}),
                        }, data: {
                            cloudflareDeploymentId: null, publicationAttemptId: null, publicationCreateStartedAt: null,
                            publicationReconcileRetryCount: 0, publicationReconcileNextAttemptAt: null,
                            errorCode: 'OSS_CLEANUP_PENDING',
                        } });
                        if (checkpointed.count !== 1) throw new Error('Old Cloudflare deployment checkpoint lost its tombstone');
                    }
                    await renewReplacementLease();
                    await deletePersistedPreviewStaging(storage, row, accountId);
                    const expired = await database.interactivePreview.updateMany({ where: { stagingGeneration: { startsWith: 'cf-' },
                        id: row.id, accountId, status: 'deleting', cloudflareDeploymentId: null,
                        publicationAttemptId: null, cleanupClaimedAt: null,
                    }, data: {
                        status: 'expired', url: null, stagingCleanupPending: false, errorCode: null,
                        cleanupClaimedAt: null, cleanupNextAttemptAt: null,
                    } });
                    if (expired.count !== 1) throw new Error('Old Cloudflare staging cleanup lost its tombstone');
                }
            }
        } catch (error) {
            if (!await replacementOwnsConnection()) await replacementSuperseded();
            await replacementCleanupFailed();
        }

        const finalizing = await (database as any).account.updateMany({ where: {
            id: accountId, cloudflareConnectionEpoch: epoch, cloudflareConnectionState: 'replacing',
            cloudflareConnectionNonce: replacementId, cloudflareConnectionReplacementId: replacementId,
        }, data: { cloudflareConnectionState: 'finalizing', cloudflareConnectionReplacementStartedAt: now() } });
        if (finalizing.count !== 1) await replacementSuperseded();
        const credential = {
            ...replacement,
            ...(sameScope && previous?.projectId ? { projectId: previous.projectId } : {}),
        };
        if ((credentialStore as any).stageConnectionReplacementInTransaction && (credentialStore as any).activatePendingConnectionReplacementInTransaction
            && (database as any).$transaction) {
            // The pending record is durable but inactive. Promotion, pending
            // deletion, and Account activation share one Prisma transaction.
            const staged = await (database as any).$transaction((transaction: any) =>
                (credentialStore as any).stageConnectionReplacementInTransaction(transaction, accountId, epoch, replacementId, credential),
            );
            if (!staged) await replacementSuperseded();
            const activated = await (database as any).$transaction((transaction: any) =>
                (credentialStore as any).activatePendingConnectionReplacementInTransaction(transaction, accountId, epoch, replacementId),
            );
            if (!activated) await replacementSuperseded();
            return;
        }

        // Narrow compatibility path for legacy unit doubles. The production
        // store always takes the pending-row transaction above.
        const replaced = (credentialStore as any).replaceAtConnectionVersion
            ? await (credentialStore as any).replaceAtConnectionVersion(accountId, epoch, replacementId, credential)
            : await (credentialStore as any).replaceAtConnectionEpoch(accountId, epoch, credential);
        if (!replaced) await replacementSuperseded();
        const activated = await (database as any).account.updateMany({ where: {
            id: accountId, cloudflareConnectionEpoch: epoch, cloudflareConnectionState: 'finalizing',
            cloudflareConnectionNonce: replacementId, cloudflareConnectionReplacementId: replacementId,
        }, data: { cloudflareConnectionState: 'active', cloudflareConnectionReplacementId: null, cloudflareConnectionReplacementStartedAt: null } });
        if (activated.count !== 1) await replacementSuperseded();
    },
    };
}

export const previewService = createPreviewService({ database: db, storage: previewStorage, credentialStore: cloudflareCredentialStore, clientFactory: createCloudflareClient });
