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
    createPublicShareUploadDescriptor,
    deletePublicShareGeneration,
    getPublicShareDownloadSource,
    publicShareAssetExists,
    putPublicShareLocalAsset,
} from '@/app/sessionSharing/publicSessionShareStorage';

const MAX_ASSET_COUNT = 100;
const MAX_ASSET_SIZE = 500 * 1024 * 1024;
const MAX_TOTAL_ASSET_SIZE = 1024 * 1024 * 1024;

const sessionParamsSchema = z.object({ sessionId: z.string().min(1) });
const draftParamsSchema = sessionParamsSchema.extend({ generation: z.string().uuid() });
const assetParamsSchema = draftParamsSchema.extend({ assetId: z.string().uuid() });
// Public handlers deliberately accept malformed identifiers and resolve them
// through the same not-found branch as revoked/unknown links. Returning Zod's
// 400 here would reveal a different public state than the product promises.
const publicParamsSchema = z.object({ publicId: z.string().min(1).max(200) });
const publicAssetParamsSchema = publicParamsSchema.extend({ assetId: z.string().min(1).max(200) });
const prepareAssetBodySchema = z.object({
    name: z.string().min(1).max(500),
    mimeType: z.string().min(1).max(200),
    kind: publicShareAssetKindSchema,
    size: z.number().int().min(0).max(MAX_ASSET_SIZE),
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
    return reply.code(404).send({ error: 'Shared session not found' });
}

function setPublicHeaders(reply: any) {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    reply.header('X-Content-Type-Options', 'nosniff');
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
    const base = path.basename(name).replace(/[\r\n"\\]/g, '_');
    return base || 'attachment';
}

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
                },
            });
            if (oldGeneration) void deletePublicShareGeneration(share.id, oldGeneration).catch(() => undefined);
        }

        return reply.send({
            generation: crypto.randomUUID(),
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

        const generationAssets = await db.publicSessionShareAsset.findMany({
            where: { shareId: share.id, generation: request.params.generation },
        });
        const totalSize = generationAssets.reduce((total, asset) => total + asset.size, 0) + request.body.size;
        if (generationAssets.length >= MAX_ASSET_COUNT || totalSize > MAX_TOTAL_ASSET_SIZE) {
            return reply.code(413).send({ error: 'Shared session attachment limit exceeded' });
        }

        const assetId = crypto.randomUUID();
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
                storagePath,
            },
        });
        const baseUrl = resolveBaseUrl(request);
        const localUrl = `${baseUrl}/v1/sessions/${request.params.sessionId}/share/drafts/${request.params.generation}/assets/${assetId}`;
        const upload = await createPublicShareUploadDescriptor(storagePath, localUrl);
        return reply.send({ assetId, ...upload });
    });

    app.put('/v1/sessions/:sessionId/share/drafts/:generation/assets/:assetId', {
        preHandler: app.authenticate,
        schema: { params: assetParamsSchema },
    }, async (request, reply) => {
        const share = await db.publicSessionShare.findFirst({
            where: { sessionId: request.params.sessionId, accountId: request.userId },
        });
        if (!share || share.revokedAt) return reply.code(404).send({ error: 'Session not found' });
        const asset = await db.publicSessionShareAsset.findFirst({
            where: { id: request.params.assetId, shareId: share.id, generation: request.params.generation },
        });
        if (!asset) return reply.code(404).send({ error: 'Shared attachment not found' });
        const body = request.body as Buffer;
        if (!Buffer.isBuffer(body) || body.length !== asset.size) {
            return reply.code(400).send({ error: 'Shared attachment size mismatch' });
        }
        try {
            await putPublicShareLocalAsset(asset.storagePath, body);
        } catch {
            return reply.code(404).send({ error: 'Direct upload not available' });
        }
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

        const assets = await db.publicSessionShareAsset.findMany({
            where: { shareId: share.id, generation: request.params.generation },
        });
        const referencedIds = attachmentIds(request.body.snapshot);
        if (assets.length !== referencedIds.size || assets.some((asset) => !referencedIds.has(asset.id))) {
            return reply.code(409).send({ error: 'Shared attachment manifest mismatch' });
        }
        for (const asset of assets) {
            if (!await publicShareAssetExists(asset.storagePath, asset.size)) {
                return reply.code(409).send({ error: 'Shared attachment upload incomplete' });
            }
        }

        const oldGeneration = share.activeGeneration;
        const publishedAt = new Date();
        const updated = await db.$transaction(async (tx) => tx.publicSessionShare.update({
            where: { id: share.id },
            data: {
                snapshot: request.body.snapshot as Prisma.InputJsonValue,
                activeGeneration: request.params.generation,
                publishedAt,
                revokedAt: null,
            },
        }));
        if (oldGeneration && oldGeneration !== request.params.generation) {
            void deletePublicShareGeneration(share.id, oldGeneration).catch(() => undefined);
            void db.publicSessionShareAsset.deleteMany({
                where: { shareId: share.id, generation: oldGeneration },
            }).catch(() => undefined);
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
        const share = await db.publicSessionShare.findUnique({ where: { sessionId: session.id } });
        if (!share || share.revokedAt) return reply.send({ ok: true });
        await db.publicSessionShare.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
        return reply.send({ ok: true });
    });

    app.get('/v1/public/session-shares/:publicId', {
        schema: { params: publicParamsSchema },
    }, async (request, reply) => {
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
        const share = await db.publicSessionShare.findUnique({ where: { publicId: request.params.publicId } });
        if (!share || share.revokedAt || !share.publishedAt || !share.activeGeneration) return publicNotFound(reply);
        const asset = await db.publicSessionShareAsset.findFirst({
            where: { id: request.params.assetId, shareId: share.id, generation: share.activeGeneration },
        });
        if (!asset) return publicNotFound(reply);
        let source: Awaited<ReturnType<typeof getPublicShareDownloadSource>>;
        try {
            source = await getPublicShareDownloadSource(asset.storagePath);
        } catch {
            return publicNotFound(reply);
        }
        setPublicHeaders(reply);
        const contentType = safeMimeType(asset.kind, asset.mimeType);
        const disposition = contentType === 'application/octet-stream' ? 'attachment' : 'inline';
        reply.header('Content-Type', contentType);
        reply.header('Content-Disposition', `${disposition}; filename="${safeDispositionName(asset.name)}"`);
        if (source.kind === 'redirect') return reply.redirect(source.url);
        return reply.type(contentType).send(source.data);
    });
}
