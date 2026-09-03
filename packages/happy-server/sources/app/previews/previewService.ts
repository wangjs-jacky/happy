import { createHash } from 'node:crypto';
import { type InteractivePreviewEvent, type InteractivePreviewManifest, validateInteractivePreviewManifest } from '@slopus/happy-wire';
import { db } from '@/storage/db';
import { previewStorage } from './previewStorage';
import { vercelCredentialStore } from './vercelCredentialStore';
import { createVercelClient } from './vercelClient';

const DRAFT_TTL_MS = 60 * 60 * 1000;
const PUBLISHED_TTL_MS = 24 * 60 * 60 * 1000;

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

export const previewService = {
    async sessionOwnedBy(accountId: string, sessionId: string): Promise<boolean> {
        return Boolean(await db.session.findFirst({ where: { id: sessionId, accountId }, select: { id: true } }));
    },
    async createDraft(accountId: string, sessionId: string, rawManifest: InteractivePreviewManifest) {
        const manifest = validateInteractivePreviewManifest(rawManifest);
        const expiresAt = new Date(Date.now() + DRAFT_TTL_MS);
        await db.interactivePreview.create({ data: {
            id: manifest.previewId, accountId, sessionId, title: manifest.title, manifest: manifest as any, expiresAt,
            assets: { create: manifest.assets.map((asset) => ({ ...asset, storageKey: previewStorage.storageKey(manifest.previewId, asset.id) })) },
        } });
        const uploads = await Promise.all(manifest.assets.map(async (asset) => ({ assetId: asset.id, ...await previewStorage.createUpload(manifest.previewId, asset.id, asset.size) })));
        return { previewId: manifest.previewId, uploads };
    },
    async completeAsset(accountId: string, previewId: string, assetId: string): Promise<void> {
        const preview = await db.interactivePreview.findFirst({ where: { id: previewId, accountId, status: 'draft' }, include: { assets: true } });
        const asset = preview?.assets.find((candidate) => candidate.id === assetId);
        if (!asset) throw new Error('Preview asset not found');
        await previewStorage.assertUploaded(previewId, assetId, asset.size);
        await db.interactivePreviewAsset.update({ where: { previewId_id: { previewId, id: assetId } }, data: { uploadedAt: new Date() } });
    },
    async publish(accountId: string, previewId: string): Promise<InteractivePreviewEvent> {
        return publishGate.run(async () => {
            let row = await db.interactivePreview.findFirst({ where: { id: previewId, accountId }, include: { assets: true } }) as PreviewRow | null;
            if (!row) throw new Error('Preview not found');
            if (row.status === 'ready') return previewRowToEvent(row);
            if (!row.assets?.length || row.assets.some((asset) => !asset.uploadedAt)) throw new Error('Preview assets are incomplete');
            const credential = await vercelCredentialStore.get(accountId);
            if (!credential) throw new Error('VERCEL_NOT_CONNECTED');
            const claimed = await db.interactivePreview.updateMany({ where: { id: previewId, accountId, status: { in: ['draft', 'failed'] } }, data: { status: 'publishing', errorCode: null } });
            if (claimed.count !== 1) {
                row = await db.interactivePreview.findFirst({ where: { id: previewId, accountId }, include: { assets: true } }) as PreviewRow | null;
                if (row?.status === 'ready') return previewRowToEvent(row);
                throw new Error('Preview publication already in progress');
            }
            try {
                const client = createVercelClient({ token: credential.accessToken, teamId: credential.teamId });
                const files = [];
                for (const asset of row.assets) {
                    const bytes = await previewStorage.read(previewId, asset.id, asset.size);
                    const digest = createHash('sha256').update(bytes).digest('hex');
                    if (digest !== asset.sha256 || bytes.length !== asset.size) throw new Error('Preview asset integrity mismatch');
                    await client.uploadFile(asset.sha256, bytes, asset.mimeType);
                    files.push({ file: asset.path, sha: asset.sha256, size: asset.size });
                }
                const deployment = await client.createDeployment({
                    name: `happy-preview-${previewId.slice(0, 8)}`, projectId: credential.projectId, files,
                    meta: { happyPreviewId: previewId },
                });
                const publishedAt = new Date(); const expiresAt = new Date(publishedAt.getTime() + PUBLISHED_TTL_MS);
                const updated = await db.interactivePreview.update({ where: { id: previewId }, data: {
                    status: 'ready', url: deployment.url, vercelDeploymentId: deployment.id, publishedAt, expiresAt,
                } }) as PreviewRow;
                try { await previewStorage.deletePreview(previewId); }
                catch { /* durable preview row is ready; scheduled cleanup removes leftover staging */ }
                return previewRowToEvent(updated);
            } catch (error) {
                await db.interactivePreview.update({ where: { id: previewId }, data: { status: 'failed', errorCode: 'PUBLISH_FAILED' } });
                throw error;
            }
        });
    },
    async list(accountId: string): Promise<InteractivePreviewEvent[]> {
        const rows = await db.interactivePreview.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 50 });
        return rows.map((row) => previewRowToEvent(row));
    },
    async delete(accountId: string, previewId: string): Promise<void> {
        const row = await db.interactivePreview.findFirst({ where: { id: previewId, accountId } }) as PreviewRow | null;
        if (!row) throw new Error('Preview not found');
        const credential = await vercelCredentialStore.get(accountId);
        if (row.vercelDeploymentId && credential) {
            await createVercelClient({ token: credential.accessToken, teamId: credential.teamId }).deleteDeployment(row.vercelDeploymentId);
        }
        await previewStorage.deletePreview(previewId);
        await db.interactivePreview.delete({ where: { id: previewId } });
    },
};
