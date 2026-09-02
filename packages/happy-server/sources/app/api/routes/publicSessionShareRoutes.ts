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
    deletePublicShareAsset,
    deletePublicShareGeneration,
    getPublicShareDownloadSource,
    publicShareAssetExists,
    putPublicShareAsset,
} from '@/app/sessionSharing/publicSessionShareStorage';
import {
    getRandomPexelsCover,
    importPexelsCover,
    PexelsConfigurationError,
    PexelsProviderError,
    type ImportedPublicSessionCover,
} from '@/app/sessionSharing/publicSessionCoverProvider';
import { createPublicShareRateLimiter } from '@/app/sessionSharing/publicSessionShareRateLimit';
import { cleanupPublicSessionShareGeneration } from '@/app/sessionSharing/publicSessionShareCleanup';
import { log } from '@/utils/log';
import { isValidShareOwnership } from '@/app/sessionSharing/publicSessionShareCapability';
import {
    publicSessionShareNotFound,
    setPublicSessionShareHeaders,
} from '@/app/sessionSharing/publicSessionShareHttp';

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
const publicParamsSchema = z.object({ publicId: z.string() });
const publicAssetParamsSchema = publicParamsSchema.extend({ assetId: z.string() });
const PUBLIC_SHARE_INTERNAL_ASSET_NAME_PREFIX = '__paws_internal__:';
const LEGACY_PEXELS_INTERNAL_ASSET_NAME_PREFIXES = ['pexels-cover-v1:', 'pexels-cover-pending:'];
const isReservedInternalAssetName = (name: string): boolean => name.startsWith(PUBLIC_SHARE_INTERNAL_ASSET_NAME_PREFIX)
    || LEGACY_PEXELS_INTERNAL_ASSET_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
const prepareAssetBodySchema = z.object({
    attachmentId: z.string().uuid(),
    name: z.string().min(1).max(500).refine((name) => !isReservedInternalAssetName(name), 'Reserved attachment name'),
    mimeType: z.string().min(1).max(200),
    kind: publicShareAssetKindSchema,
    size: z.number().int().min(0).max(MAX_ASSET_SIZE),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const importCoverBodySchema = z.object({
    assetId: z.string().uuid(),
    photoId: z.number().int().positive(),
}).strict();
const persistedPexelsCoverMetadataSchema = z.object({
    width: z.number().int().positive().max(100_000),
    height: z.number().int().positive().max(100_000),
    attribution: z.object({
        photoId: z.number().int().positive(),
        photographer: z.string().min(1).max(200),
        photographerUrl: z.string().url().max(1_000),
        photoUrl: z.string().url().max(1_000),
    }).strict(),
}).strict();
const pexelsCoverClaimSchema = z.object({
    photoId: z.number().int().positive(),
    token: z.string().uuid(),
    leaseUntil: z.number().int().positive(),
}).strict();
const PEXELS_COVER_METADATA_PREFIX = `${PUBLIC_SHARE_INTERNAL_ASSET_NAME_PREFIX}pexels-cover-v1:`;
const PEXELS_COVER_CLAIM_PREFIX = `${PUBLIC_SHARE_INTERNAL_ASSET_NAME_PREFIX}pexels-claim-v1:`;
const PEXELS_COVER_CLAIM_LEASE_MS = 2 * 60 * 1000;
const MAX_INTERNAL_ASSET_NAME_BYTES = 4 * 1024;
const PEXELS_PENDING_SHA256 = '0'.repeat(64);

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

function validPublicId(value: string): boolean {
    return /^(?:[A-Za-z0-9_-]{43}|ps_[A-Za-z0-9_-]{43})$/.test(value);
}

function validAssetId(value: string): boolean {
    return z.string().uuid().safeParse(value).success;
}

function encodeInternalAssetName(prefix: string, value: unknown): string | null {
    const encoded = `${prefix}${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
    return Buffer.byteLength(encoded, 'utf8') <= MAX_INTERNAL_ASSET_NAME_BYTES ? encoded : null;
}

function decodeInternalAssetName<T>(name: string, prefix: string, schema: z.ZodType<T>): T | null {
    if (!name.startsWith(prefix) || Buffer.byteLength(name, 'utf8') > MAX_INTERNAL_ASSET_NAME_BYTES) return null;
    const encoded = name.slice(prefix.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
    try {
        const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
        const canonicalEncoding = Buffer.from(decoded, 'utf8').toString('base64url');
        if (canonicalEncoding !== encoded) return null;
        return schema.parse(JSON.parse(decoded));
    } catch {
        return null;
    }
}

function encodePersistedPexelsCoverMetadata(imported: ImportedPublicSessionCover): string | null {
    // Cover manifests intentionally omit a filename, and the approved schema
    // has no mutable provider-metadata column. Keep the canonical retry
    // descriptor in this existing row so retries need neither a migration nor
    // a second object-storage path.
    const metadata = {
        width: imported.width,
        height: imported.height,
        attribution: imported.attribution,
    };
    const parsed = persistedPexelsCoverMetadataSchema.safeParse(metadata);
    return parsed.success ? encodeInternalAssetName(PEXELS_COVER_METADATA_PREFIX, parsed.data) : null;
}

function decodePersistedPexelsCoverMetadata(name: string): z.infer<typeof persistedPexelsCoverMetadataSchema> | null {
    return decodeInternalAssetName(name, PEXELS_COVER_METADATA_PREFIX, persistedPexelsCoverMetadataSchema);
}

function encodePexelsCoverClaim(photoId: number, token: string, leaseUntil: number): string {
    const name = encodeInternalAssetName(PEXELS_COVER_CLAIM_PREFIX, { photoId, token, leaseUntil });
    if (!name) throw new Error('Pexels cover claim exceeds internal metadata limit');
    return name;
}

function decodePexelsCoverClaim(name: string): z.infer<typeof pexelsCoverClaimSchema> | null {
    return decodeInternalAssetName(name, PEXELS_COVER_CLAIM_PREFIX, pexelsCoverClaimSchema);
}

function canonicalImportedCoverResponse(
    assetId: string,
    mimeType: string,
    size: number,
    metadata: z.infer<typeof persistedPexelsCoverMetadataSchema>,
) {
    return {
        assetId,
        mimeType,
        size,
        width: metadata.width,
        height: metadata.height,
        attribution: metadata.attribution,
    };
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
    setPublicSessionShareHeaders(reply);
    reply.header('Retry-After', result.retryAfterSeconds);
    reply.code(429).send({ error: 'Too many requests. Try again in a minute.' });
    return false;
}

type PublicSessionShareAssetDescriptor = {
    assetId: string;
    kind: string;
    mimeType: string;
    size: number;
    name?: string;
};

export function collectPublicSessionShareAssetManifest(snapshot: PublicSessionSnapshot): PublicSessionShareAssetDescriptor[] {
    const assets: PublicSessionShareAssetDescriptor[] = [];
    for (const message of snapshot.messages) {
        for (const block of message.blocks) {
            if (block.type === 'attachment') {
                assets.push({
                    assetId: block.attachmentId,
                    kind: block.kind,
                    mimeType: block.mimeType,
                    size: block.size,
                    name: block.name,
                });
            }
        }
    }
    if (snapshot.version === 2 && snapshot.appearance.cover) {
        assets.push({
            assetId: snapshot.appearance.cover.assetId,
            kind: 'image',
            mimeType: snapshot.appearance.cover.mimeType,
            size: snapshot.appearance.cover.size,
        });
    }
    return assets;
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
class PublicShareRequestError extends Error {
    constructor(readonly statusCode: number, message: string) {
        super(message);
    }
}

async function serializableTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await db.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
            if ((error as { code?: string })?.code !== 'P2034' || attempt === 2) throw error;
        }
    }
    throw new Error('Serializable transaction retry exhausted');
}

async function cleanupShareGenerationWhenPossible(shareId: string, generation: string): Promise<void> {
    try {
        await cleanupPublicSessionShareGeneration(shareId, generation);
    } catch (error) {
        log({ module: 'public-session-share-cleanup', level: 'error', shareId, generation, error }, 'Deferred public share generation cleanup');
    }
}

async function cleanupImportedCoverObjectWhenPossible(
    storagePath: string,
    details: { shareId: string; generation: string; assetId: string },
): Promise<boolean> {
    try {
        await deletePublicShareAsset(storagePath);
        return true;
    } catch (error) {
        log({
            module: 'public-session-cover-import-cleanup',
            level: 'error',
            ...details,
            error,
        }, 'Failed to clean imported cover object; retaining the draft asset for retry');
        return false;
    }
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
        const parsedSnapshot = active ? publicSessionSnapshotSchema.safeParse(share!.snapshot) : null;
        return reply.send({
            active,
            publicId: active ? share!.publicId : null,
            publishedAt: active ? share!.publishedAt!.getTime() : null,
            ...(parsedSnapshot?.success && parsedSnapshot.data.version === 2
                ? { appearance: parsedSnapshot.data.appearance }
                : {}),
        });
    });

    app.get('/v1/sessions/:sessionId/share/covers/random', {
        preHandler: app.authenticate,
        schema: { params: sessionParamsSchema },
    }, async (request, reply) => {
        const session = await db.session.findFirst({
            where: { id: request.params.sessionId, accountId: request.userId },
            select: { id: true },
        });
        if (!session) return reply.code(404).send({ error: 'Session not found' });
        if (!await enforceShareWriteRate(request.userId, reply)) return;
        const apiKey = process.env.PEXELS_API_KEY;
        if (!apiKey) return reply.code(503).send({ error: 'Random cover provider is unavailable' });
        try {
            return reply.send(await getRandomPexelsCover(fetch, apiKey, Math.random));
        } catch (error) {
            if (error instanceof PexelsConfigurationError) {
                return reply.code(503).send({ error: 'Random cover provider is unavailable' });
            }
            if (error instanceof PexelsProviderError) {
                return reply.code(502).send({ error: 'Random cover provider request failed' });
            }
            throw error;
        }
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

        const generation = crypto.randomUUID();
        let result: {
            shareId: string;
            publicId: string;
            cleanupGenerations: string[];
        };
        try {
            result = await serializableTransaction(async (tx) => {
                const now = new Date();
                let share = await tx.publicSessionShare.findUnique({ where: { sessionId: session.id } });
                let oldGeneration: string | null = null;
                if (!share) {
                    const ownership = { accountId: request.userId, sessionId: session.id, managementTokenHash: null };
                    if (!isValidShareOwnership(ownership)) throw new Error('Invalid public share ownership');
                    share = await tx.publicSessionShare.create({
                        data: { publicId: newPublicId(), accountId: request.userId, sessionId: session.id },
                    });
                } else if (share.revokedAt) {
                    oldGeneration = share.activeGeneration;
                    share = await tx.publicSessionShare.update({
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
                }

                const previousDrafts = await tx.publicSessionShareDraft.findMany({
                    where: { shareId: share.id, status: 'pending' },
                    select: { id: true, expiresAt: true },
                });
                const pendingForAccount = await tx.publicSessionShareDraft.count({
                    where: {
                        status: 'pending',
                        expiresAt: { gt: now },
                        share: { accountId: request.userId },
                    },
                });
                const replaceablePending = previousDrafts.filter((draft) => draft.expiresAt > now).length;
                if (pendingForAccount - replaceablePending >= MAX_PENDING_DRAFTS_PER_ACCOUNT) {
                    throw new PublicShareRequestError(429, 'Too many pending shared-session drafts');
                }

                const draftLifecycleVersion = share.lifecycleVersion + 1;
                const changed = await tx.publicSessionShare.updateMany({
                    where: { id: share.id, lifecycleVersion: share.lifecycleVersion, revokedAt: null },
                    data: { lifecycleVersion: { increment: 1 } },
                });
                if (changed.count !== 1) throw new StaleShareDraftError();
                if (previousDrafts.length > 0) {
                    await tx.publicSessionShareDraft.updateMany({
                        where: { id: { in: previousDrafts.map((draft) => draft.id) }, shareId: share.id },
                        data: { status: 'superseded', expiresAt: now },
                    });
                }
                if (oldGeneration) {
                    await tx.publicSessionShareDraft.updateMany({
                        where: { id: oldGeneration, shareId: share.id },
                        data: { status: 'superseded', expiresAt: now },
                    });
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
                return {
                    shareId: share.id,
                    publicId: share.publicId,
                    cleanupGenerations: [
                        ...previousDrafts.map((draft) => draft.id),
                        ...(oldGeneration ? [oldGeneration] : []),
                    ],
                };
            });
        } catch (error) {
            if (error instanceof StaleShareDraftError) {
                return reply.code(409).send({ error: 'Shared-session state changed; retry' });
            }
            if (error instanceof PublicShareRequestError) {
                return reply.code(error.statusCode).send({ error: error.message });
            }
            throw error;
        }
        for (const cleanupGeneration of new Set(result.cleanupGenerations)) {
            await cleanupShareGenerationWhenPossible(result.shareId, cleanupGeneration);
        }

        return reply.send({
            generation,
            publicId: result.publicId,
        });
    });

    app.post('/v1/sessions/:sessionId/share/drafts/:generation/assets', {
        preHandler: app.authenticate,
        schema: { params: draftParamsSchema, body: prepareAssetBodySchema },
    }, async (request, reply) => {
        if (!await enforceShareWriteRate(request.userId, reply)) return;
        const assetId = request.body.attachmentId;
        const name = safeDispositionName(request.body.name);
        try {
            await serializableTransaction(async (tx) => {
                const now = new Date();
                const share = await tx.publicSessionShare.findFirst({
                    where: { sessionId: request.params.sessionId, accountId: request.userId },
                });
                if (!share || share.revokedAt) throw new PublicShareRequestError(404, 'Session not found');
                const draft = await tx.publicSessionShareDraft.findFirst({
                    where: {
                        id: request.params.generation,
                        shareId: share.id,
                        lifecycleVersion: share.lifecycleVersion,
                        status: 'pending',
                        expiresAt: { gt: now },
                    },
                });
                if (!draft) throw new PublicShareRequestError(409, 'Shared-session draft is unavailable');

                const generationAssets = await tx.publicSessionShareAsset.findMany({
                    where: { shareId: share.id, generation: request.params.generation },
                });
                if (generationAssets.some((asset) => asset.id === assetId)) {
                    throw new PublicShareRequestError(409, 'Shared attachment already exists');
                }
                const totalSize = generationAssets.reduce((total, asset) => total + asset.size, 0) + request.body.size;
                if (generationAssets.length >= MAX_ASSET_COUNT || totalSize > MAX_TOTAL_ASSET_SIZE) {
                    throw new PublicShareRequestError(413, 'Shared session attachment limit exceeded');
                }
                const accountPendingSize = await tx.publicSessionShareAsset.aggregate({
                    where: {
                        share: { accountId: request.userId },
                        draft: { status: 'pending', expiresAt: { gt: now } },
                    },
                    _sum: { size: true },
                });
                if ((accountPendingSize._sum.size ?? 0) + request.body.size > MAX_PENDING_ASSET_SIZE_PER_ACCOUNT) {
                    throw new PublicShareRequestError(413, 'Pending shared-session storage limit exceeded');
                }

                const storagePath = buildPublicShareStoragePath(share.id, request.params.generation, assetId);
                await tx.publicSessionShareAsset.create({
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
            });
        } catch (error) {
            if (error instanceof PublicShareRequestError) {
                return reply.code(error.statusCode).send({ error: error.message });
            }
            throw error;
        }
        const baseUrl = resolveBaseUrl(request);
        const localUrl = `${baseUrl}/v1/sessions/${request.params.sessionId}/share/drafts/${request.params.generation}/assets/${assetId}`;
        return reply.send({ assetId, method: 'PUT', uploadUrl: localUrl });
    });

    app.post('/v1/sessions/:sessionId/share/drafts/:generation/covers/import', {
        preHandler: app.authenticate,
        schema: { params: draftParamsSchema, body: importCoverBodySchema },
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
        const apiKey = process.env.PEXELS_API_KEY;
        if (!apiKey) return reply.code(503).send({ error: 'Random cover provider is unavailable' });

        const claimToken = crypto.randomUUID();
        const pendingName = encodePexelsCoverClaim(
            request.body.photoId,
            claimToken,
            Date.now() + PEXELS_COVER_CLAIM_LEASE_MS,
        );
        const storagePath = buildPublicShareStoragePath(
            share.id,
            draft.id,
            `${request.body.assetId}_${claimToken}`,
        );
        let replacedStoragePath: string | null = null;
        let existingResponse: ReturnType<typeof canonicalImportedCoverResponse> | null = null;
        try {
            await serializableTransaction(async (tx) => {
                const now = new Date();
                const currentShare = await tx.publicSessionShare.findFirst({
                    where: {
                        id: share.id,
                        sessionId: request.params.sessionId,
                        accountId: request.userId,
                        lifecycleVersion: share.lifecycleVersion,
                        revokedAt: null,
                    },
                });
                if (!currentShare) throw new StaleShareDraftError();
                const currentDraft = await tx.publicSessionShareDraft.findFirst({
                    where: {
                        id: draft.id,
                        shareId: share.id,
                        lifecycleVersion: share.lifecycleVersion,
                        status: 'pending',
                        expiresAt: { gt: now },
                    },
                });
                if (!currentDraft) throw new StaleShareDraftError();

                const existing = await tx.publicSessionShareAsset.findFirst({
                    where: { id: request.body.assetId, shareId: share.id, generation: draft.id },
                });
                if (existing) {
                    const metadata = existing.uploadedAt
                        ? decodePersistedPexelsCoverMetadata(existing.name)
                        : null;
                    if (metadata
                        && existing.mimeType === 'image/webp'
                        && existing.kind === 'image'
                        && existing.size > 0
                        && existing.sha256 !== PEXELS_PENDING_SHA256) {
                        existingResponse = canonicalImportedCoverResponse(
                            request.body.assetId,
                            existing.mimeType,
                            existing.size,
                            metadata,
                        );
                        return;
                    }
                    const currentClaim = existing.uploadedAt ? null : decodePexelsCoverClaim(existing.name);
                    if (currentClaim && currentClaim.leaseUntil <= Date.now()) {
                        const takenOver = await tx.publicSessionShareAsset.updateMany({
                            where: {
                                id: request.body.assetId,
                                shareId: share.id,
                                generation: draft.id,
                                name: existing.name,
                                storagePath: existing.storagePath,
                                uploadedAt: null,
                            },
                            data: {
                                name: pendingName,
                                storagePath,
                                mimeType: 'image/webp',
                                kind: 'image',
                                size: 0,
                                sha256: PEXELS_PENDING_SHA256,
                            },
                        });
                        if (takenOver.count !== 1) throw new StaleShareDraftError();
                        replacedStoragePath = existing.storagePath;
                        return;
                    }
                    throw new PublicShareRequestError(409, 'Shared attachment already exists');
                }

                const generationAssets = await tx.publicSessionShareAsset.findMany({
                    where: { shareId: share.id, generation: draft.id },
                });
                if (generationAssets.length >= MAX_ASSET_COUNT) {
                    throw new PublicShareRequestError(413, 'Shared session attachment limit exceeded');
                }
                await tx.publicSessionShareAsset.create({
                    data: {
                        id: request.body.assetId,
                        shareId: share.id,
                        generation: draft.id,
                        name: pendingName,
                        mimeType: 'image/webp',
                        kind: 'image',
                        size: 0,
                        sha256: PEXELS_PENDING_SHA256,
                        storagePath,
                    },
                });
            });
        } catch (error) {
            if (error instanceof StaleShareDraftError) {
                return reply.code(409).send({ error: 'Shared-session draft is unavailable' });
            }
            if (error instanceof PublicShareRequestError) {
                return reply.code(error.statusCode).send({ error: error.message });
            }
            if ((error as { code?: string })?.code === 'P2002') {
                return reply.code(409).send({ error: 'Shared attachment already exists' });
            }
            throw error;
        }
        if (existingResponse) return reply.send(existingResponse);

        const cleanupDetails = {
            shareId: share.id,
            generation: draft.id,
            assetId: request.body.assetId,
        };
        const ownsClaim = async (): Promise<boolean> => Boolean(await db.publicSessionShareAsset.findFirst({
            where: {
                id: request.body.assetId,
                shareId: share.id,
                generation: draft.id,
                name: pendingName,
                storagePath,
                uploadedAt: null,
            },
        }));
        const releaseClaimWhenPossible = async (): Promise<boolean> => {
            try {
                const released = await db.publicSessionShareAsset.deleteMany({
                    where: {
                        id: request.body.assetId,
                        shareId: share.id,
                        generation: draft.id,
                        name: pendingName,
                        storagePath,
                        uploadedAt: null,
                    },
                });
                return released.count === 1;
            } catch (error) {
                log({
                    module: 'public-session-cover-claim-release',
                    level: 'error',
                    ...cleanupDetails,
                    error,
                }, 'Failed to release cover import claim; retaining it for bounded lease recovery');
                return false;
            }
        };
        if (replacedStoragePath) {
            await cleanupImportedCoverObjectWhenPossible(replacedStoragePath, cleanupDetails);
        }
        let imported: ImportedPublicSessionCover;
        try {
            imported = await importPexelsCover(request.body.photoId, { fetchImpl: fetch, apiKey });
        } catch (error) {
            await releaseClaimWhenPossible();
            if (error instanceof PexelsConfigurationError) {
                return reply.code(503).send({ error: 'Random cover provider is unavailable' });
            }
            if (error instanceof PexelsProviderError) {
                return reply.code(502).send({ error: 'Random cover provider request failed' });
            }
            throw error;
        }

        const persistedName = encodePersistedPexelsCoverMetadata(imported);
        if (!persistedName) {
            await releaseClaimWhenPossible();
            return reply.code(502).send({ error: 'Random cover provider request failed' });
        }
        if (!await ownsClaim()) {
            return reply.code(409).send({ error: 'Shared attachment already exists' });
        }
        const sha256 = crypto.createHash('sha256').update(imported.bytes).digest('hex');
        const responseBody = canonicalImportedCoverResponse(
            request.body.assetId,
            imported.mimeType,
            imported.size,
            { width: imported.width, height: imported.height, attribution: imported.attribution },
        );
        try {
            await putPublicShareAsset(storagePath, imported.bytes);
        } catch {
            if (await cleanupImportedCoverObjectWhenPossible(storagePath, cleanupDetails)) {
                await releaseClaimWhenPossible();
            }
            return reply.code(503).send({ error: 'Cover storage is unavailable' });
        }
        try {
            await serializableTransaction(async (tx) => {
                const now = new Date();
                const currentShare = await tx.publicSessionShare.findFirst({
                    where: {
                        id: share.id,
                        sessionId: request.params.sessionId,
                        accountId: request.userId,
                        lifecycleVersion: share.lifecycleVersion,
                        revokedAt: null,
                    },
                });
                if (!currentShare) throw new StaleShareDraftError();
                const currentDraft = await tx.publicSessionShareDraft.findFirst({
                    where: {
                        id: draft.id,
                        shareId: share.id,
                        lifecycleVersion: share.lifecycleVersion,
                        status: 'pending',
                        expiresAt: { gt: now },
                    },
                });
                if (!currentDraft) throw new StaleShareDraftError();

                const generationAssets = await tx.publicSessionShareAsset.findMany({
                    where: { shareId: share.id, generation: draft.id },
                });
                const totalSize = generationAssets.reduce((total, asset) => total + asset.size, 0) + imported.size;
                if (totalSize > MAX_TOTAL_ASSET_SIZE) {
                    throw new PublicShareRequestError(413, 'Shared session attachment limit exceeded');
                }
                const accountPendingSize = await tx.publicSessionShareAsset.aggregate({
                    where: {
                        share: { accountId: request.userId },
                        draft: { status: 'pending', expiresAt: { gt: now } },
                    },
                    _sum: { size: true },
                });
                if ((accountPendingSize._sum.size ?? 0) + imported.size > MAX_PENDING_ASSET_SIZE_PER_ACCOUNT) {
                    throw new PublicShareRequestError(413, 'Pending shared-session storage limit exceeded');
                }
                const finalized = await tx.publicSessionShareAsset.updateMany({
                    where: {
                        id: request.body.assetId,
                        shareId: share.id,
                        generation: draft.id,
                        name: pendingName,
                        storagePath,
                        uploadedAt: null,
                    },
                    data: {
                        name: persistedName,
                        mimeType: imported.mimeType,
                        size: imported.size,
                        sha256,
                        uploadedAt: now,
                    },
                });
                if (finalized.count !== 1) throw new StaleShareDraftError();
            });
        } catch (error) {
            if (error instanceof StaleShareDraftError || error instanceof PublicShareRequestError) {
                if (await cleanupImportedCoverObjectWhenPossible(storagePath, cleanupDetails)) {
                    await releaseClaimWhenPossible();
                }
                if (error instanceof StaleShareDraftError) {
                    return reply.code(409).send({ error: 'Shared-session draft is unavailable' });
                }
                return reply.code(error.statusCode).send({ error: error.message });
            }
            log({
                module: 'public-session-cover-import-finalize',
                level: 'error',
                ...cleanupDetails,
                error,
            }, 'Cover import finalization was ambiguous; retaining the draft asset and object for retry');
            throw error;
        }
        return reply.send(responseBody);
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
        const manifest = collectPublicSessionShareAssetManifest(request.body.snapshot);
        const referencedIds = new Set(manifest.map((asset) => asset.assetId));
        if (assets.length !== referencedIds.size || assets.some((asset) => !referencedIds.has(asset.id))) {
            return reply.code(409).send({ error: 'Shared attachment manifest mismatch' });
        }
        const assetById = new Map(assets.map((asset) => [asset.id, asset]));
        for (const descriptor of manifest) {
            const asset = assetById.get(descriptor.assetId);
            if (!asset
                || (descriptor.name !== undefined && descriptor.name !== asset.name)
                || descriptor.mimeType !== asset.mimeType
                || descriptor.kind !== asset.kind
                || descriptor.size !== asset.size) {
                return reply.code(409).send({ error: 'Shared attachment metadata mismatch' });
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
                if (oldGeneration && oldGeneration !== request.params.generation) {
                    await tx.publicSessionShareDraft.updateMany({
                        where: { id: oldGeneration, shareId: share.id },
                        data: { status: 'superseded', expiresAt: new Date() },
                    });
                }
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
            await cleanupShareGenerationWhenPossible(share.id, oldGeneration);
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
        // Revocation is the terminal operation for the current public id. Do
        // not condition it on a previously-read lifecycle version. The share
        // and every cleanup marker commit atomically so a crash cannot leave a
        // revoked public id whose published generation is excluded forever
        // from the retry worker.
        const revocation = await serializableTransaction(async (tx) => {
            const share = await tx.publicSessionShare.findUnique({ where: { sessionId: session.id } });
            if (!share || share.revokedAt) return null;
            const revokedAt = new Date();
            const revoked = await tx.publicSessionShare.updateMany({
                where: { id: share.id, revokedAt: null },
                data: { revokedAt, lifecycleVersion: { increment: 1 } },
            });
            if (revoked.count !== 1) return null;
            await tx.publicSessionShareDraft.updateMany({
                where: { shareId: share.id },
                data: { status: 'revoked', expiresAt: revokedAt },
            });
            const generations = await tx.publicSessionShareDraft.findMany({
                where: { shareId: share.id },
                select: { id: true },
            });
            return {
                shareId: share.id,
                activeGeneration: share.activeGeneration,
                generations: generations.map((draft) => draft.id),
            };
        });
        if (revocation) {
            const generationIds = new Set(revocation.generations);
            if (revocation.activeGeneration) generationIds.add(revocation.activeGeneration);
            await Promise.all(Array.from(generationIds, (generation) => (
                cleanupShareGenerationWhenPossible(revocation.shareId, generation)
            )));
        }
        return reply.send({ ok: true });
    });

    app.get('/v1/public/session-shares/:publicId', {
        schema: { params: publicParamsSchema },
    }, async (request, reply) => {
        if (!await enforcePublicReadRate(request.ip, reply)) return;
        if (!validPublicId(request.params.publicId)) return publicSessionShareNotFound(reply);
        const share = await db.publicSessionShare.findUnique({ where: { publicId: request.params.publicId } });
        if (!share
            || share.revokedAt
            || (share.expiresAt && share.expiresAt <= new Date())
            || !share.publishedAt
            || !share.snapshot
            || !share.activeGeneration) {
            return publicSessionShareNotFound(reply);
        }
        const parsed = publicSessionSnapshotSchema.safeParse(share.snapshot);
        if (!parsed.success) return publicSessionShareNotFound(reply);
        setPublicSessionShareHeaders(reply);
        return reply.send({ snapshot: parsed.data, publishedAt: share.publishedAt.getTime() });
    });

    app.get('/v1/public/session-shares/:publicId/attachments/:assetId', {
        schema: { params: publicAssetParamsSchema },
    }, async (request, reply) => {
        if (!await enforcePublicReadRate(request.ip, reply)) return;
        if (!validPublicId(request.params.publicId) || !validAssetId(request.params.assetId)) return publicSessionShareNotFound(reply);
        const share = await db.publicSessionShare.findUnique({ where: { publicId: request.params.publicId } });
        if (!share
            || share.revokedAt
            || (share.expiresAt && share.expiresAt <= new Date())
            || !share.publishedAt
            || !share.activeGeneration) return publicSessionShareNotFound(reply);
        const asset = await db.publicSessionShareAsset.findFirst({
            where: { id: request.params.assetId, shareId: share.id, generation: share.activeGeneration },
        });
        if (!asset) return publicSessionShareNotFound(reply);
        const contentType = safeMimeType(asset.kind, asset.mimeType);
        const disposition = contentType === 'application/octet-stream' ? 'attachment' : 'inline';
        const publicName = decodePersistedPexelsCoverMetadata(asset.name) ? 'cover.webp' : asset.name;
        const attachmentDisposition = contentDisposition(disposition, publicName);
        let source: Awaited<ReturnType<typeof getPublicShareDownloadSource>>;
        try {
            source = await getPublicShareDownloadSource(asset.storagePath);
        } catch {
            return publicSessionShareNotFound(reply);
        }
        setPublicSessionShareHeaders(reply);
        reply.header('Content-Type', contentType);
        reply.header('Content-Disposition', attachmentDisposition);
        return reply.type(contentType).send(source.data);
    });

    // Fastify's router rejects path parameters over its safety limit before a
    // parameterized handler runs. Keep those malformed public URLs
    // indistinguishable from unknown, expired, and revoked shares.
    app.get('/v1/public/session-shares/*', async (_request, reply) => publicSessionShareNotFound(reply));
}
