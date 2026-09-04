import { createHash } from 'node:crypto';
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
    errorCode: string | null; accountId?: string; vercelDeploymentId?: string | null;
    assets?: Array<{ id: string; path: string; mimeType: string; size: number; sha256: string; uploadedAt: Date | null }>;
};

export function previewRowToEvent(row: PreviewRow): InteractivePreviewEvent {
    const state = row.status === 'ready' ? 'ready' : row.status === 'expired' ? 'expired' : row.status === 'failed' ? 'failed' : 'publishing';
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
    return {
    async sessionOwnedBy(accountId: string, sessionId: string): Promise<boolean> {
        return Boolean(await database.session.findFirst({ where: { id: sessionId, accountId }, select: { id: true } }));
    },
    async createDraft(accountId: string, sessionId: string, rawManifest: InteractivePreviewManifest) {
        const manifest = validateInteractivePreviewManifest(rawManifest);
        const expiresAt = new Date(now().getTime() + DRAFT_TTL_MS);
        await database.interactivePreview.create({ data: {
            id: manifest.previewId, accountId, sessionId, title: manifest.title, manifest: manifest as any, expiresAt,
            assets: { create: manifest.assets.map((asset) => ({ ...asset, storageKey: storage.storageKey(manifest.previewId, asset.id) })) },
        } });
        const uploads = await Promise.all(manifest.assets.map(async (asset) => ({ assetId: asset.id, ...await storage.createUpload(manifest.previewId, asset.id, asset.size) })));
        return { previewId: manifest.previewId, uploads };
    },
    async completeAsset(accountId: string, previewId: string, assetId: string): Promise<void> {
        const preview = await database.interactivePreview.findFirst({ where: { id: previewId, accountId, status: 'draft' }, include: { assets: true } });
        const asset = preview?.assets.find((candidate) => candidate.id === assetId);
        if (!asset) throw new Error('Preview asset not found');
        await storage.assertUploaded(previewId, assetId, asset.size);
        await database.interactivePreviewAsset.update({ where: { previewId_id: { previewId, id: assetId } }, data: { uploadedAt: now() } });
    },
    async publish(accountId: string, previewId: string): Promise<InteractivePreviewEvent> {
        return publishGate.run(async () => {
            let createdDeploymentId: string | null = null;
            let row = await database.interactivePreview.findFirst({ where: { id: previewId, accountId }, include: { assets: true } }) as PreviewRow | null;
            if (!row) throw new Error('Preview not found');
            if (row.status === 'ready') return previewRowToEvent(row);
            if (!row.assets?.length || row.assets.some((asset) => !asset.uploadedAt)) throw new Error('Preview assets are incomplete');
            if (row.assets.some((asset) => asset.path === 'vercel.json')) throw new Error('Preview manifest may not include vercel.json');
            const credential = await credentialStore.get(accountId);
            if (!credential) throw new Error('VERCEL_NOT_CONNECTED');
            const claimed = await database.interactivePreview.updateMany({ where: { id: previewId, accountId, status: { in: ['draft', 'failed'] } }, data: { status: 'publishing', errorCode: null } });
            if (claimed.count !== 1) {
                row = await database.interactivePreview.findFirst({ where: { id: previewId, accountId }, include: { assets: true } }) as PreviewRow | null;
                if (row?.status === 'ready') return previewRowToEvent(row);
                throw new Error('Preview publication already in progress');
            }
            try {
                const client = clientFactory({ token: credential.accessToken, teamId: credential.teamId });
                const project = await client.ensurePreviewProject({
                    configurationId: credential.configurationId,
                    ...(credential.projectId ? { projectId: credential.projectId } : {}),
                });
                if (credential.projectId !== project.id) {
                    const persisted = await credentialStore.setProjectIdIfCurrent(accountId, credential, project.id);
                    if (!persisted) throw new Error('Vercel connection changed during project provisioning');
                }
                const files = [];
                for (const asset of row.assets) {
                    const bytes = await storage.read(previewId, asset.id, asset.size);
                    const digest = createHash('sha256').update(bytes).digest('hex');
                    if (digest !== asset.sha256 || bytes.length !== asset.size) throw new Error('Preview asset integrity mismatch');
                    await client.uploadFile(asset.sha256, bytes, asset.mimeType);
                    files.push({ file: asset.path, sha: asset.sha256, size: asset.size });
                }
                const configBytes = Buffer.from(VERCEL_PREVIEW_CONFIG);
                const configSha = createHash('sha256').update(configBytes).digest('hex');
                await client.uploadFile(configSha, configBytes, 'application/json');
                files.push({ file: 'vercel.json', sha: configSha, size: configBytes.byteLength });
                const deployment = await client.createDeployment({
                    name: 'happy-previews', projectId: project.id, files,
                    meta: { happyPreviewId: previewId },
                    onCreated: async ({ id }) => {
                        createdDeploymentId = id;
                        await database.interactivePreview.update({ where: { id: previewId }, data: { vercelDeploymentId: id } });
                    },
                });
                createdDeploymentId = deployment.id;
                const publishedAt = now(); const expiresAt = new Date(publishedAt.getTime() + PUBLISHED_TTL_MS);
                const updated = await database.interactivePreview.update({ where: { id: previewId }, data: {
                    status: 'ready', url: deployment.url, vercelDeploymentId: deployment.id, publishedAt, expiresAt,
                } }) as PreviewRow;
                try { await storage.deletePreview(previewId); }
                catch { /* durable preview row is ready; scheduled cleanup removes leftover staging */ }
                return previewRowToEvent(updated);
            } catch (error) {
                await database.interactivePreview.update({ where: { id: previewId }, data: {
                    status: 'failed', errorCode: 'PUBLISH_FAILED', ...(createdDeploymentId ? { vercelDeploymentId: createdDeploymentId } : {}),
                } });
                throw error;
            }
        });
    },
    async list(accountId: string): Promise<InteractivePreviewEvent[]> {
        const rows = await database.interactivePreview.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 50 });
        return rows.map((row) => previewRowToEvent(row));
    },
    async delete(accountId: string, previewId: string): Promise<void> {
        const row = await database.interactivePreview.findFirst({ where: { id: previewId, accountId } }) as PreviewRow | null;
        if (!row) throw new Error('Preview not found');
        const credential = await credentialStore.get(accountId);
        if (row.vercelDeploymentId && credential) {
            await clientFactory({ token: credential.accessToken, teamId: credential.teamId }).deleteDeployment(row.vercelDeploymentId);
        }
        await storage.deletePreview(previewId);
        await database.interactivePreview.delete({ where: { id: previewId } });
    },
    };
}

export const previewService = createPreviewService({ database: db, storage: previewStorage, credentialStore: vercelCredentialStore, clientFactory: createVercelClient });
