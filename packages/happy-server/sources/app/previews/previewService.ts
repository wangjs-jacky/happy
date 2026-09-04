import { createHash, randomUUID } from 'node:crypto';
import { type InteractivePreviewEvent, type InteractivePreviewManifest, validateInteractivePreviewManifest } from '@slopus/happy-wire';
import { db } from '@/storage/db';
import { previewStorage } from './previewStorage';
import { vercelCredentialStore } from './vercelCredentialStore';
import { createVercelClient } from './vercelClient';

const DRAFT_TTL_MS = 60 * 60 * 1000;
const PUBLISHED_TTL_MS = 24 * 60 * 60 * 1000;
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
        if (existing) {
            if (existing.accountId !== accountId || existing.sessionId !== sessionId || !manifestsMatch(existing.manifest, manifest)) throw previewNotFound();
            return describeUploads(existing);
        }
        const expiresAt = new Date(now().getTime() + DRAFT_TTL_MS);
        const stagingGeneration = randomUUID();
        const assetRecords = manifest.assets.map((asset) => ({
            ...asset,
            storageKey: storage.storageKey({ accountId, previewId: manifest.previewId, stagingGeneration }, asset.id),
        }));
        try {
            const created = await database.interactivePreview.create({ data: {
                id: manifest.previewId, accountId, sessionId, title: manifest.title, manifest: manifest as any, expiresAt, stagingGeneration,
                assets: { create: assetRecords },
            }, include: { assets: true } }) as PreviewRow;
            return describeUploads(created);
        } catch (error) {
            if (!uniqueViolation(error)) throw error;
            const raced = await database.interactivePreview.findUnique({ where: { id: manifest.previewId }, include: { assets: true } }) as PreviewRow | null;
            if (!raced || raced.accountId !== accountId || raced.sessionId !== sessionId || !manifestsMatch(raced.manifest, manifest)) throw previewNotFound();
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
        return publishGate.run(async () => {
            let createdDeploymentId: string | null = null;
            let row = await database.interactivePreview.findFirst({ where: { id: previewId, accountId, sessionId }, include: { assets: true } }) as PreviewRow | null;
            if (!row) throw previewNotFound();
            if (row.status === 'ready') return previewRowToEvent(row);
            if (row.status === 'publishing') return previewRowToEvent(row);
            if (!row.assets?.length || row.assets.some((asset) => !asset.uploadedAt)) throw new Error('Preview assets are incomplete');
            if (row.assets.some((asset) => asset.path === 'vercel.json')) throw new Error('Preview manifest may not include vercel.json');
            const publicationAttemptId = row.publicationAttemptId || randomUUID();
            const publicationGeneration = (row.publicationGeneration ?? 0) + 1;
            const connectionGeneration = row.connectionGeneration ?? 0;
            const publicationWhere = {
                id: previewId, accountId, sessionId, status: 'publishing', publicationAttemptId, publicationGeneration, connectionGeneration,
            };
            const claimed = await database.interactivePreview.updateMany({
                where: {
                    id: previewId, accountId, sessionId, status: { in: ['draft', 'failed'] },
                    publicationGeneration: row.publicationGeneration ?? 0, connectionGeneration,
                    cleanupClaimedAt: null,
                },
                data: { status: 'publishing', errorCode: null, publicationAttemptId, publicationGeneration },
            });
            if (claimed.count !== 1) {
                row = await database.interactivePreview.findFirst({ where: { id: previewId, accountId, sessionId }, include: { assets: true } }) as PreviewRow | null;
                if (row?.status === 'ready') return previewRowToEvent(row);
                if (row?.status === 'publishing') return previewRowToEvent(row);
                throw new Error('Preview publication already in progress');
            }
            const deleteUnclaimedDeployment = async (client: { deleteDeployment?: (deploymentId: string) => Promise<void> }, deploymentId: string) => {
                try { await client.deleteDeployment?.(deploymentId); } catch { /* the durable tombstone will reconcile this attempt */ }
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
                const client = clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                const project = await client.ensurePreviewProject({
                    configurationId: credential.configurationId,
                    ...(credential.projectId ? { projectId: credential.projectId } : {}),
                });
                if (credential.projectId !== project.id) {
                    const persisted = await credentialStore.setProjectIdIfCurrent(accountId, credential, project.id);
                    if (!persisted) throw new Error('Vercel connection changed during project provisioning');
                }
                const recoveredDeployment = await client.findDeploymentByMetadata?.({ projectId: project.id, happyPreviewId: previewId, publicationAttemptId }) ?? null;
                let deployment: { id: string; url: string; readyState?: string } | null = recoveredDeployment;
                if (deployment) {
                    try { await bindDeployment(deployment.id); }
                    catch (error) { await deleteUnclaimedDeployment(client, deployment.id); throw error; }
                }
                const files = [];
                if (!deployment) {
                    for (const asset of row.assets) {
                        const bytes = await storage.read(asset.storageKey, asset.size);
                        const digest = createHash('sha256').update(bytes).digest('hex');
                        if (digest !== asset.sha256 || bytes.length !== asset.size) throw new Error('Preview asset integrity mismatch');
                        await client.uploadFile(asset.sha256, bytes, asset.mimeType);
                        files.push({ file: asset.path, sha: asset.sha256, size: asset.size });
                    }
                    const configBytes = Buffer.from(VERCEL_PREVIEW_CONFIG);
                    const configSha = createHash('sha256').update(configBytes).digest('hex');
                    await client.uploadFile(configSha, configBytes, 'application/json');
                    files.push({ file: 'vercel.json', sha: configSha, size: configBytes.byteLength });
                    deployment = await client.createDeployment({
                        name: 'happy-previews', projectId: project.id, files,
                        meta: { happyPreviewId: previewId, happyPublicationAttemptId: publicationAttemptId },
                        onCreated: async ({ id }) => {
                            try { await bindDeployment(id); }
                            catch (error) { await deleteUnclaimedDeployment(client, id); throw error; }
                        },
                    });
                }
                if (!deployment) throw new Error('Vercel deployment reconciliation returned no deployment');
                createdDeploymentId = deployment.id;
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
                    await storage.deletePreview({ accountId, previewId, stagingGeneration: row.stagingGeneration! });
                    await database.interactivePreview.updateMany({
                        where: { ...publicationWhere, status: 'ready', stagingCleanupPending: true },
                        data: { stagingCleanupPending: false, cleanupRetryCount: 0, cleanupNextAttemptAt: null },
                    });
                } catch { /* ready rows retain a durable, immediately due staging cleanup obligation */ }
                return previewRowToEvent(updated);
            } catch (error) {
                await database.interactivePreview.updateMany({
                    where: { ...publicationWhere, ...(createdDeploymentId ? { OR: [{ vercelDeploymentId: null }, { vercelDeploymentId: createdDeploymentId }] } : {}) },
                    data: { status: 'failed', errorCode: 'PUBLISH_FAILED', ...(createdDeploymentId ? { vercelDeploymentId: createdDeploymentId } : {}) },
                });
                throw error;
            }
        });
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
            data: { status: 'deleting', url: null, errorCode: null, publicationGeneration: { increment: 1 } },
        });
    },
    async disconnectVercel(accountId: string): Promise<{ warning?: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' }> {
        await database.interactivePreview.updateMany({ where: {
            accountId, status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] },
        }, data: {
            status: 'deleting', url: null, errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING',
            publicationGeneration: { increment: 1 }, connectionGeneration: { increment: 1 },
        } });
        const credential = await credentialStore.get(accountId);
        const rows = await database.interactivePreview.findMany({ where: {
            accountId, status: { in: ['draft', 'publishing', 'failed', 'ready', 'deleting'] },
        }, select: { id: true, vercelDeploymentId: true, stagingGeneration: true, publicationAttemptId: true, cleanupClaimedAt: true, cleanupNextAttemptAt: true } }) as Array<{ id: string; vercelDeploymentId: string | null; stagingGeneration: string; publicationAttemptId: string | null; cleanupClaimedAt: Date | null; cleanupNextAttemptAt: Date | null }>;
        let warning = false;
        const client = credential ? clientFactory({ token: credential.accessToken, teamId: credential.teamId }) : null;
        for (const row of rows) {
            if (row.cleanupClaimedAt) {
                warning = true;
                continue;
            }
            try {
                let deploymentId = row.vercelDeploymentId;
                if (!deploymentId && row.publicationAttemptId && credential?.projectId) {
                    deploymentId = (await client?.findDeploymentByMetadata?.({ projectId: credential.projectId, happyPreviewId: row.id, publicationAttemptId: row.publicationAttemptId }))?.id || null;
                    if (deploymentId) {
                        const persisted = await database.interactivePreview.updateMany({
                            where: { id: row.id, accountId, status: 'deleting', vercelDeploymentId: null, cleanupClaimedAt: null },
                            data: { vercelDeploymentId: deploymentId },
                        });
                        if (persisted.count !== 1) throw new Error('Preview cleanup claim changed during disconnect');
                    }
                }
                if (deploymentId) {
                    if (!client) throw new Error('Vercel credential unavailable');
                    await client.deleteDeployment(deploymentId);
                }
                await storage.deletePreview({ accountId, previewId: row.id, stagingGeneration: row.stagingGeneration });
                const expired = await database.interactivePreview.updateMany({
                    where: { id: row.id, accountId, status: 'deleting', cleanupClaimedAt: null, ...(deploymentId ? { vercelDeploymentId: deploymentId } : {}) },
                    data: { status: 'expired', url: null, vercelDeploymentId: null, stagingCleanupPending: false, cleanupClaimedAt: null, cleanupNextAttemptAt: null },
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
    };
}

export const previewService = createPreviewService({ database: db, storage: previewStorage, credentialStore: vercelCredentialStore, clientFactory: createVercelClient });
