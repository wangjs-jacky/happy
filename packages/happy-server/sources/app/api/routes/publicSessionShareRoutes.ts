import * as crypto from 'crypto';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Fastify } from '../types';
import { db } from '@/storage/db';
import {
    publicSessionSnapshotSchema,
    publicShareAssetKindSchema,
    type PublicSessionSnapshot,
} from '@/app/sessionSharing/publicSessionShareSchemas';
import {
    buildPublicShareStoragePath,
    deletePublicShareGeneration,
    getPublicShareDownloadSource,
    publicShareAssetExists,
    putPublicShareAsset,
} from '@/app/sessionSharing/publicSessionShareStorage';
import { createPublicShareRateLimiter } from '@/app/sessionSharing/publicSessionShareRateLimit';

const MAX_ASSET_COUNT = 100;
// This matches Fastify's global binary-body limit. Share uploads are proxied
// through the authenticated server so object storage never receives a reusable
// upload URL and exact size/hash enforcement is identical in both modes.
const MAX_ASSET_SIZE = 100 * 1024 * 1024;
const MAX_TOTAL_ASSET_SIZE = 1024 * 1024 * 1024;
const MAX_PENDING_ASSET_SIZE_PER_ACCOUNT = 2 * 1024 * 1024 * 1024;
const DRAFT_TTL_MS = 60 * 60 * 1000;
const MAX_PENDING_DRAFTS_PER_ACCOUNT = 20;
const shareWriteRate = createPublicShareRateLimiter({ scope: 'owner-write', max: 600, windowMs: 60_000 });
const publicReadRate = createPublicShareRateLimiter({ scope: 'public-read', max: 600, windowMs: 60_000 });

const sessionParamsSchema = z.object({ sessionId: z.string().min(1) });
const draftParamsSchema = sessionParamsSchema.extend({ generation: z.string().uuid() });
const assetParamsSchema = draftParamsSchema.extend({ assetId: z.string().uuid() });
// Public handlers deliberately accept malformed identifiers and resolve them
// through the same not-found branch as revoked/unknown links. Returning Zod's
// 400 here would reveal a different public state than the product promises.
const publicParamsSchema = z.object({ publicId: z.string().min(1).max(200) });
const publicAssetParamsSchema = publicParamsSchema.extend({ assetId: z.string().min(1).max(200) });
const prepareAssetBodySchema = z.object({
    attachmentId: z.string().uuid(),
    name: z.string().min(1).max(500),
    mimeType: z.string().min(1).max(200),
    kind: publicShareAssetKindSchema,
    size: z.number().int().min(0).max(MAX_ASSET_SIZE),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

function resolveBaseUrl(request: { headers: Record<string, string | string[] | undefined> }): string {
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
    const forwardedHost = request.headers['x-forwarded-host'];
    const forwardedProto = request.headers['x-forwarded-proto'];
    const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host;
    const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ?? 'http';
    return typeof host === 'string' && host ? `${protocol}://${host}` : `http://localhost:${process.env.PORT || '3005'}`;
}

function newPublicId(): string {
    return crypto.randomBytes(32).toString('base64url');
}

function publicNotFound(reply: any) {
    setPublicHeaders(reply);
    return reply.code(404).send({ error: 'Shared session not found' });
}

function setPublicHeaders(reply: any) {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    reply.header('X-Content-Type-Options', 'nosniff');
}

async function enforceShareWriteRate(userId: string, reply: any): Promise<boolean> {
    const result = await shareWriteRate.check(userId);
    if (result.allowed) return true;
    reply.header('Retry-After', result.retryAfterSeconds);
    reply.code(429).send({ error: 'Too many share requests. Try again in a minute.' });
    return false;
}

async function enforcePublicReadRate(key: string, reply: any): Promise<boolean> {
    const result = await publicReadRate.check(key);
    if (result.allowed) return true;
    setPublicHeaders(reply);
    reply.header('Retry-After', result.retryAfterSeconds);
    reply.code(429).send({ error: 'Too many requests. Try again in a minute.' });
    return false;
}

function attachmentIds(snapshot: PublicSessionSnapshot): Set<string> {
    const ids = new Set<string>();
    for (const message of snapshot.messages) {
        for (const block of message.blocks) {
            if (block.type === 'attachment') ids.add(block.attachmentId);
        }
    }
    return ids;
}

function safeMimeType(kind: string, mimeType: string): string {
    const inline = kind === 'image'
        ? /^(image\/(png|jpeg|gif|webp))$/i.test(mimeType)
        : kind === 'audio'
            ? /^(audio\/(mpeg|mp4|aac|wav|flac|ogg|opus))$/i.test(mimeType)
            : kind === 'video'
                ? /^(video\/(mp4|quicktime|webm|x-m4v))$/i.test(mimeType)
                : false;
    return inline ? mimeType.toLowerCase() : 'application/octet-stream';
}

function safeDispositionName(name: string): string {
    const base = path.basename(name).replace(/[\u0000-\u001f\u007f"\\]/g, '_');
    return base || 'attachment';
}

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
    const safeName = safeDispositionName(name);
    const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, '_') || 'attachment';
    const encoded = encodeURIComponent(safeName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${kind}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function draftExpiry(): Date {
    return new Date(Date.now() + DRAFT_TTL_MS);
}

class StaleShareDraftError extends Error {}

export function publicSessionShareRoutes(app: Fastify) {
    app.get('/v1/sessions/:sessionId/share', {
        preHandler: app.authenticate,
        schema: { params: sessionParamsSchema },
    }, async (request, reply) => {
        const session = await db.session.findFirst({
            where: { id: request.params.sessionId, accountId: request.userId },
            select: { id: true },
        });
        if (!session) return reply.code(404).send({ error: 'Session not found' });
        const share = await db.publicSessionShare.findUnique({ where: { sessionId: session.id } });
        const active = Boolean(share?.publishedAt && !share.revokedAt && share.snapshot);
        return reply.send({
            active,
            publicId: active ? share!.publicId : null,
            publishedAt: active ? share!.publishedAt!.getTime() : null,
        });
    });

    app.post('/v1/sessions/:sessionId/share/drafts', {
        preHandler: app.authenticate,
        schema: { params: sessionParamsSchema },
    }, async (request, reply) => {
        const session = await db.session.findFirst({
            where: { id: request.params.sessionId, accountId: request.userId },
            select: { id: true, accountId: true },
        });
        if (!session) return reply.code(404).send({ error: 'Session not found' });
        if (!await enforceShareWriteRate(request.userId, reply)) return;

        const now = new Date();
        const expiredDrafts = await db.publicSessionShareDraft.findMany({
            where: {
                status: 'pending',
                expiresAt: { lte: now },
                share: { accountId: request.userId },
            },
            select: { id: true, shareId: true },
            take: 100,
        });
        if (expiredDrafts.length > 0) {
            await db.publicSessionShareDraft.deleteMany({ where: { id: { in: expiredDrafts.map((draft) => draft.id) } } });
            for (const draft of expiredDrafts) {
                void deletePublicShareGeneration(draft.shareId, draft.id).catch(() => undefined);
            }
        }

        let share = await db.publicSessionShare.findUnique({ where: { sessionId: session.id } });
        if (!share) {
            share = await db.publicSessionShare.create({
                data: { publicId: newPublicId(), accountId: request.userId, sessionId: session.id },
            });
        } else if (share.revokedAt) {
            const oldGeneration = share.activeGeneration;
            share = await db.publicSessionShare.update({
                where: { id: share.id },
                data: {
                    publicId: newPublicId(),
                    snapshot: Prisma.JsonNull,
                    activeGeneration: null,
                    publishedAt: null,
                    revokedAt: null,
                    lifecycleVersion: { increment: 1 },
                },
            });
            if (oldGeneration) void deletePublicShareGeneration(share.id, oldGeneration).catch(() => undefined);
        }

        const previousDrafts = await db.publicSessionShareDraft.findMany({
            where: { shareId: share.id, status: 'pending' },
            select: { id: true },
        });
        const pendingForAccount = await db.publicSessionShareDraft.count({
            where: {
                status: 'pending',
                expiresAt: { gt: now },
                share: { accountId: request.userId },
            },
        });
        if (pendingForAccount - previousDrafts.length >= MAX_PENDING_DRAFTS_PER_ACCOUNT) {
            return reply.code(429).send({ error: 'Too many pending shared-session drafts' });
        }

        const generation = crypto.randomUUID();
        const draftLifecycleVersion = share.lifecycleVersion + 1;
        try {
            await db.$transaction(async (tx) => {
                const changed = await tx.publicSessionShare.updateMany({
                    where: { id: share.id, lifecycleVersion: share.lifecycleVersion, revokedAt: null },
                    data: { lifecycleVersion: { increment: 1 } },
                });
                if (changed.count !== 1) throw new StaleShareDraftError();
                if (previousDrafts.length > 0) {
                    await tx.publicSessionShareDraft.deleteMany({ where: { id: { in: previousDrafts.map((draft) => draft.id) } } });
                }
                await tx.publicSessionShareDraft.create({
                    data: {
                        id: generation,
                        shareId: share.id,
                        lifecycleVersion: draftLifecycleVersion,
                        status: 'pending',
                        expiresAt: draftExpiry(),
                    },
                });
            });
        } catch (error) {
            if (error instanceof StaleShareDraftError) {
                return reply.code(409).send({ error: 'Shared-session state changed; retry' });
            }
            throw error;
        }
        for (const draft of previousDrafts) {
            void deletePublicShareGeneration(share.id, draft.id).catch(() => undefined);
        }

        return reply.send({
            generation,
            publicId: share.publicId,
        });
    });

    app.post('/v1/sessions/:sessionId/share/drafts/:generation/assets', {
        preHandler: app.authenticate,
        schema: { params: draftParamsSchema, body: prepareAssetBodySchema },
    }, async (request, reply) => {
        const share = await db.publicSessionShare.findFirst({
            where: { sessionId: request.params.sessionId, accountId: request.userId },
        });
        if (!share || share.revokedAt) return reply.code(404).send({ error: 'Session not found' });
        if (!await enforceShareWriteRate(request.userId, reply)) return;
        const draft = await db.publicSessionShareDraft.findFirst({
            where: {
                id: request.params.generation,
                shareId: share.id,
                lifecycleVersion: share.lifecycleVersion,
                status: 'pending',
                expiresAt: { gt: new Date() },
            },
        });
        if (!draft) return reply.code(409).send({ error: 'Shared-session draft is unavailable' });

        const generationAssets = await db.publicSessionShareAsset.findMany({
            where: { shareId: share.id, generation: request.params.generation },
        });
        if (generationAssets.some((asset) => asset.id === request.body.attachmentId)) {
            return reply.code(409).send({ error: 'Shared attachment already exists' });
        }
        const totalSize = generationAssets.reduce((total, asset) => total + asset.size, 0) + request.body.size;
        if (generationAssets.length >= MAX_ASSET_COUNT || totalSize > MAX_TOTAL_ASSET_SIZE) {
            return reply.code(413).send({ error: 'Shared session attachment limit exceeded' });
        }
        const accountPendingSize = await db.publicSessionShareAsset.aggregate({
            where: {
                share: { accountId: request.userId },
                draft: { status: 'pending', expiresAt: { gt: new Date() } },
            },
            _sum: { size: true },
        });
        if ((accountPendingSize._sum.size ?? 0) + request.body.size > MAX_PENDING_ASSET_SIZE_PER_ACCOUNT) {
            return reply.code(413).send({ error: 'Pending shared-session storage limit exceeded' });
        }

        const assetId = request.body.attachmentId;
        const name = safeDispositionName(request.body.name);
        const storagePath = buildPublicShareStoragePath(share.id, request.params.generation, assetId);
        await db.publicSessionShareAsset.create({
            data: {
                id: assetId,
                shareId: share.id,
                generation: request.params.generation,
                name,
                mimeType: request.body.mimeType,
                kind: request.body.kind,
                size: request.body.size,
                sha256: request.body.sha256,
                storagePath,
            },
        });
        const baseUrl = resolveBaseUrl(request);
        const localUrl = `${baseUrl}/v1/sessions/${request.params.sessionId}/share/drafts/${request.params.generation}/assets/${assetId}`;
        return reply.send({ assetId, method: 'PUT', uploadUrl: localUrl });
    });

    app.put('/v1/sessions/:sessionId/share/drafts/:generation/assets/:assetId', {
        preHandler: app.authenticate,
        schema: { params: assetParamsSchema },
    }, async (request, reply) => {
        const share = await db.publicSessionShare.findFirst({
            where: { sessionId: request.params.sessionId, accountId: request.userId },
        });
        if (!share || share.revokedAt) return reply.code(404).send({ error: 'Session not found' });
        if (!await enforceShareWriteRate(request.userId, reply)) return;
        const draft = await db.publicSessionShareDraft.findFirst({
            where: {
                id: request.params.generation,
                shareId: share.id,
                lifecycleVersion: share.lifecycleVersion,
                status: 'pending',
                expiresAt: { gt: new Date() },
            },
        });
        if (!draft) return reply.code(409).send({ error: 'Shared-session draft is unavailable' });
        const asset = await db.publicSessionShareAsset.findFirst({
            where: { id: request.params.assetId, shareId: share.id, generation: request.params.generation },
        });
        if (!asset) return reply.code(404).send({ error: 'Shared attachment not found' });
        if (asset.uploadedAt) return reply.code(409).send({ error: 'Shared attachment is immutable' });
        const body = request.body as Buffer;
        if (!Buffer.isBuffer(body) || body.length !== asset.size) {
            return reply.code(400).send({ error: 'Shared attachment size mismatch' });
        }
        const digest = crypto.createHash('sha256').update(body).digest('hex');
        if (digest !== asset.sha256) {
            return reply.code(400).send({ error: 'Shared attachment checksum mismatch' });
        }
        await putPublicShareAsset(asset.storagePath, body);
        const stillPending = await db.publicSessionShareDraft.findFirst({
            where: {
                id: draft.id,
                shareId: share.id,
                lifecycleVersion: share.lifecycleVersion,
                status: 'pending',
                expiresAt: { gt: new Date() },
                share: { revokedAt: null, lifecycleVersion: share.lifecycleVersion },
            },
        });
        if (!stillPending) {
            await deletePublicShareGeneration(share.id, draft.id).catch(() => undefined);
            return reply.code(409).send({ error: 'Shared-session draft is unavailable' });
        }
        const marked = await db.publicSessionShareAsset.updateMany({
            where: { id: asset.id, shareId: share.id, generation: draft.id, uploadedAt: null },
            data: { uploadedAt: new Date() },
        });
        if (marked.count !== 1) return reply.code(409).send({ error: 'Shared attachment is immutable' });
        return reply.send({ ok: true });
    });

    app.put('/v1/sessions/:sessionId/share/drafts/:generation/publish', {
        preHandler: app.authenticate,
        schema: {
            params: draftParamsSchema,
            body: z.object({ snapshot: publicSessionSnapshotSchema }).strict(),
        },
    }, async (request, reply) => {
        const share = await db.publicSessionShare.findFirst({
            where: { sessionId: request.params.sessionId, accountId: request.userId },
        });
        if (!share || share.revokedAt) return reply.code(404).send({ error: 'Session not found' });
        if (!await enforceShareWriteRate(request.userId, reply)) return;
        const draft = await db.publicSessionShareDraft.findFirst({
            where: {
                id: request.params.generation,
                shareId: share.id,
                lifecycleVersion: share.lifecycleVersion,
                status: 'pending',
                expiresAt: { gt: new Date() },
            },
        });
        if (!draft) return reply.code(409).send({ error: 'Shared-session draft is unavailable' });

        const assets = await db.publicSessionShareAsset.findMany({
            where: { shareId: share.id, generation: request.params.generation },
        });
        const referencedIds = attachmentIds(request.body.snapshot);
        if (assets.length !== referencedIds.size || assets.some((asset) => !referencedIds.has(asset.id))) {
            return reply.code(409).send({ error: 'Shared attachment manifest mismatch' });
        }
        const assetById = new Map(assets.map((asset) => [asset.id, asset]));
        for (const message of request.body.snapshot.messages) {
            for (const block of message.blocks) {
                if (block.type !== 'attachment') continue;
                const asset = assetById.get(block.attachmentId);
                if (!asset
                    || block.name !== asset.name
                    || block.mimeType !== asset.mimeType
                    || block.kind !== asset.kind
                    || block.size !== asset.size) {
                    return reply.code(409).send({ error: 'Shared attachment metadata mismatch' });
                }
            }
        }
        for (const asset of assets) {
            if (!asset.uploadedAt || !await publicShareAssetExists(asset.storagePath, asset.size)) {
                return reply.code(409).send({ error: 'Shared attachment upload incomplete' });
            }
        }

        const oldGeneration = share.activeGeneration;
        const publishedAt = new Date();
        let updated;
        try {
            updated = await db.$transaction(async (tx) => {
                const changed = await tx.publicSessionShare.updateMany({
                    where: { id: share.id, lifecycleVersion: draft.lifecycleVersion, revokedAt: null },
                    data: {
                        snapshot: request.body.snapshot as Prisma.InputJsonValue,
                        activeGeneration: request.params.generation,
                        publishedAt,
                        lifecycleVersion: { increment: 1 },
                    },
                });
                if (changed.count !== 1) throw new StaleShareDraftError();
                const finalized = await tx.publicSessionShareDraft.updateMany({
                    where: {
                        id: draft.id,
                        shareId: share.id,
                        lifecycleVersion: draft.lifecycleVersion,
                        status: 'pending',
                        expiresAt: { gt: new Date() },
                    },
                    data: { status: 'published' },
                });
                if (finalized.count !== 1) throw new StaleShareDraftError();
                return tx.publicSessionShare.findUniqueOrThrow({ where: { id: share.id } });
            });
        } catch (error) {
            if (error instanceof StaleShareDraftError) {
                return reply.code(409).send({ error: 'Shared-session draft is stale' });
            }
            throw error;
        }
        if (oldGeneration && oldGeneration !== request.params.generation) {
            void deletePublicShareGeneration(share.id, oldGeneration).catch(() => undefined);
            void db.publicSessionShareDraft.deleteMany({ where: { id: oldGeneration, shareId: share.id } }).catch(() => undefined);
        }
        return reply.send({ publicId: updated.publicId, publishedAt: publishedAt.getTime() });
    });

    app.delete('/v1/sessions/:sessionId/share', {
        preHandler: app.authenticate,
        schema: { params: sessionParamsSchema },
    }, async (request, reply) => {
        const session = await db.session.findFirst({
            where: { id: request.params.sessionId, accountId: request.userId },
            select: { id: true },
        });
        if (!session) return reply.code(404).send({ error: 'Session not found' });
        if (!await enforceShareWriteRate(request.userId, reply)) return;
        const share = await db.publicSessionShare.findUnique({ where: { sessionId: session.id } });
        if (!share || share.revokedAt) return reply.send({ ok: true });
        // Revocation is the terminal operation for the current public id. Do
        // not condition it on a previously-read lifecycle version: if a
        // publish transaction commits between this read and the update,
        // revoke must still win instead of silently reporting success.
        const revoked = await db.publicSessionShare.updateMany({
            where: { id: share.id, revokedAt: null },
            data: { revokedAt: new Date(), lifecycleVersion: { increment: 1 } },
        });
        if (revoked.count === 1) {
            const generations = await db.publicSessionShareDraft.findMany({
                where: { shareId: share.id },
                select: { id: true },
            });
            await db.publicSessionShareDraft.deleteMany({ where: { shareId: share.id } });
            const generationIds = new Set(generations.map((draft) => draft.id));
            if (share.activeGeneration) generationIds.add(share.activeGeneration);
            await Promise.all(Array.from(generationIds, (generation) => (
                deletePublicShareGeneration(share.id, generation).catch(() => undefined)
            )));
        }
        return reply.send({ ok: true });
    });

    app.get('/v1/public/session-shares/:publicId', {
        schema: { params: publicParamsSchema },
    }, async (request, reply) => {
        if (!await enforcePublicReadRate(`${request.ip}:${request.params.publicId}`, reply)) return;
        const share = await db.publicSessionShare.findUnique({ where: { publicId: request.params.publicId } });
        if (!share || share.revokedAt || !share.publishedAt || !share.snapshot || !share.activeGeneration) {
            return publicNotFound(reply);
        }
        const parsed = publicSessionSnapshotSchema.safeParse(share.snapshot);
        if (!parsed.success) return publicNotFound(reply);
        setPublicHeaders(reply);
        return reply.send({ snapshot: parsed.data, publishedAt: share.publishedAt.getTime() });
    });

    app.get('/v1/public/session-shares/:publicId/attachments/:assetId', {
        schema: { params: publicAssetParamsSchema },
    }, async (request, reply) => {
        if (!await enforcePublicReadRate(`${request.ip}:${request.params.publicId}`, reply)) return;
        const share = await db.publicSessionShare.findUnique({ where: { publicId: request.params.publicId } });
        if (!share || share.revokedAt || !share.publishedAt || !share.activeGeneration) return publicNotFound(reply);
        const asset = await db.publicSessionShareAsset.findFirst({
            where: { id: request.params.assetId, shareId: share.id, generation: share.activeGeneration },
        });
        if (!asset) return publicNotFound(reply);
        const contentType = safeMimeType(asset.kind, asset.mimeType);
        const disposition = contentType === 'application/octet-stream' ? 'attachment' : 'inline';
        const attachmentDisposition = contentDisposition(disposition, asset.name);
        let source: Awaited<ReturnType<typeof getPublicShareDownloadSource>>;
        try {
            source = await getPublicShareDownloadSource(asset.storagePath);
        } catch {
            return publicNotFound(reply);
        }
        setPublicHeaders(reply);
        reply.header('Content-Type', contentType);
        reply.header('Content-Disposition', attachmentDisposition);
        return reply.type(contentType).send(source.data);
    });
}
