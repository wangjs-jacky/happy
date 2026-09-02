import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Fastify } from '../types';

type ShareRow = {
    id: string;
    publicId: string;
    accountId: string;
    sessionId: string;
    snapshot: unknown;
    activeGeneration: string | null;
    publishedAt: Date | null;
    revokedAt: Date | null;
    lifecycleVersion: number;
    createdAt: Date;
    updatedAt: Date;
};

type DraftRow = {
    id: string;
    shareId: string;
    lifecycleVersion: number;
    status: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
};

type AssetRow = {
    id: string;
    shareId: string;
    generation: string;
    name: string;
    mimeType: string;
    kind: string;
    size: number;
    sha256: string;
    uploadedAt: Date | null;
    storagePath: string;
    createdAt: Date;
};

const { state, dbMock, storageMock, providerMock, resetState } = vi.hoisted(() => {
    const state = {
        sessions: [] as Array<{ id: string; accountId: string }>,
        shares: [] as ShareRow[],
        drafts: [] as DraftRow[],
        assets: [] as AssetRow[],
        bytes: new Map<string, Buffer>(),
        nextShare: 1,
    };

    const matches = (value: Record<string, any>, where: Record<string, any>): boolean => Object.entries(where).every(([key, wanted]) => {
        const actual = key === 'share'
            ? state.shares.find((share) => share.id === value.shareId)
            : key === 'draft'
                ? state.drafts.find((draft) => draft.id === value.generation)
                : value[key];
        if (wanted && typeof wanted === 'object' && !Array.isArray(wanted) && !(wanted instanceof Date)) {
            if ('not' in wanted && actual === wanted.not) return false;
            if ('in' in wanted && !wanted.in.includes(actual)) return false;
            if ('gt' in wanted && !(actual > wanted.gt)) return false;
            if ('lte' in wanted && !(actual <= wanted.lte)) return false;
            const operatorKeys = new Set(['not', 'in', 'gt', 'lte']);
            const nested = Object.fromEntries(Object.entries(wanted).filter(([operator]) => !operatorKeys.has(operator)));
            return Object.keys(nested).length === 0 || Boolean(actual && matches(actual, nested));
        }
        return actual === wanted;
    });

    const applyData = (row: Record<string, any>, data: Record<string, any>) => {
        for (const [key, value] of Object.entries(data)) {
            row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
        }
        row.updatedAt = new Date();
    };

    const publicSessionShare = {
        findUnique: vi.fn(async ({ where }: any) => state.shares.find((row) => matches(row, where)) ?? null),
        findFirst: vi.fn(async ({ where }: any) => state.shares.find((row) => matches(row, where)) ?? null),
        create: vi.fn(async ({ data }: any) => {
            const now = new Date();
            const row: ShareRow = {
                id: `share-${state.nextShare++}`,
                snapshot: null,
                activeGeneration: null,
                publishedAt: null,
                revokedAt: null,
                lifecycleVersion: 1,
                createdAt: now,
                updatedAt: now,
                ...data,
            };
            state.shares.push(row);
            return row;
        }),
        update: vi.fn(async ({ where, data }: any) => {
            const row = state.shares.find((candidate) => matches(candidate, where));
            if (!row) throw new Error('share missing');
            applyData(row, data);
            return row;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
            const rows = state.shares.filter((row) => matches(row, where));
            rows.forEach((row) => applyData(row, data));
            return { count: rows.length };
        }),
        findUniqueOrThrow: vi.fn(async ({ where }: any) => {
            const row = state.shares.find((candidate) => matches(candidate, where));
            if (!row) throw new Error('share missing');
            return row;
        }),
    };
    const publicSessionShareDraft = {
        findMany: vi.fn(async ({ where, select, take }: any) => {
            const matchingRows = state.drafts.filter((row) => matches(row, where));
            const rows = typeof take === 'number' ? matchingRows.slice(0, take) : matchingRows;
            return select ? rows.map((row) => Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]]))) : rows;
        }),
        findFirst: vi.fn(async ({ where }: any) => state.drafts.find((row) => matches(row, where)) ?? null),
        count: vi.fn(async ({ where }: any) => state.drafts.filter((row) => matches(row, where)).length),
        create: vi.fn(async ({ data }: any) => {
            const now = new Date();
            const row = { createdAt: now, updatedAt: now, ...data } as DraftRow;
            state.drafts.push(row);
            return row;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
            const rows = state.drafts.filter((row) => matches(row, where));
            rows.forEach((row) => applyData(row, data));
            return { count: rows.length };
        }),
        deleteMany: vi.fn(async ({ where }: any) => {
            const deletedIds = state.drafts.filter((row) => matches(row, where)).map((row) => row.id);
            state.drafts = state.drafts.filter((row) => !deletedIds.includes(row.id));
            state.assets = state.assets.filter((asset) => !deletedIds.includes(asset.generation));
            return { count: deletedIds.length };
        }),
    };
    const publicSessionShareAsset = {
        findMany: vi.fn(async ({ where }: any) => state.assets.filter((row) => matches(row, where))),
        findFirst: vi.fn(async ({ where }: any) => state.assets.find((row) => matches(row, where)) ?? null),
        create: vi.fn(async ({ data }: any) => {
            const row = { createdAt: new Date(), uploadedAt: null, ...data } as AssetRow;
            state.assets.push(row);
            return row;
        }),
        aggregate: vi.fn(async ({ where }: any) => ({
            _sum: { size: state.assets.filter((row) => matches(row, where)).reduce((sum, row) => sum + row.size, 0) || null },
        })),
        updateMany: vi.fn(async ({ where, data }: any) => {
            const rows = state.assets.filter((row) => matches(row, where));
            rows.forEach((row) => applyData(row, data));
            return { count: rows.length };
        }),
        deleteMany: vi.fn(async ({ where }: any) => {
            const before = state.assets.length;
            state.assets = state.assets.filter((row) => !matches(row, where));
            return { count: before - state.assets.length };
        }),
    };
    const dbMock: any = {
        session: {
            findFirst: vi.fn(async ({ where }: any) => state.sessions.find((row) => matches(row, where)) ?? null),
        },
        publicSessionShare,
        publicSessionShareDraft,
        publicSessionShareAsset,
    };
    dbMock.$transaction = vi.fn(async (callback: any) => callback(dbMock));

    const storageMock = {
        buildPublicShareStoragePath: vi.fn((shareId: string, generation: string, assetId: string) =>
            `private/session-shares/${shareId}/${generation}/${assetId}`),
        putPublicShareAsset: vi.fn(async (path: string, bytes: Buffer) => { state.bytes.set(path, bytes); }),
        publicShareAssetExists: vi.fn(async (path: string, size: number) => state.bytes.get(path)?.length === size),
        getPublicShareDownloadSource: vi.fn(async (path: string) => {
            const data = state.bytes.get(path);
            if (!data) throw new Error('missing');
            return { kind: 'buffer' as const, data };
        }),
        deletePublicShareGeneration: vi.fn(async () => undefined),
        deletePublicShareAsset: vi.fn(async (path: string) => { state.bytes.delete(path); }),
    };

    const providerMock = {
        getRandomPexelsCover: vi.fn(async () => ({
            provider: 'pexels' as const,
            photoId: 2014422,
            previewUrl: 'https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg',
            width: 3024,
            height: 3024,
            averageColor: '#6E6353',
            attribution: {
                photographer: 'Eberhard Grossgasteiger',
                photographerUrl: 'https://www.pexels.com/@eberhardgross',
                photoUrl: 'https://www.pexels.com/photo/brown-rocks-during-golden-hour-2014422/',
            },
        })),
        importPexelsCover: vi.fn(async () => ({
            bytes: Buffer.from('webp'),
            mimeType: 'image/webp' as const,
            size: 4,
            width: 2400,
            height: 900,
            attribution: {
                photoId: 2014422,
                photographer: 'Eberhard Grossgasteiger',
                photographerUrl: 'https://www.pexels.com/@eberhardgross',
                photoUrl: 'https://www.pexels.com/photo/brown-rocks-during-golden-hour-2014422/',
            },
        })),
        PexelsConfigurationError: class PexelsConfigurationError extends Error {},
        PexelsProviderError: class PexelsProviderError extends Error {},
    };

    const resetState = () => {
        state.sessions = [];
        state.shares = [];
        state.drafts = [];
        state.assets = [];
        state.bytes.clear();
        state.nextShare = 1;
        delete process.env.PEXELS_API_KEY;
        vi.clearAllMocks();
    };
    return { state, dbMock, storageMock, providerMock, resetState };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/app/sessionSharing/publicSessionShareStorage', () => storageMock);
vi.mock('@/app/sessionSharing/publicSessionCoverProvider', () => providerMock);

import { publicSessionShareRoutes } from './publicSessionShareRoutes';
import { enableErrorHandlers } from '../utils/enableErrorHandlers';

async function createApp() {
    const app = fastify({ bodyLimit: 10 * 1024 * 1024 });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate('authenticate', async (request: any, reply: any) => {
        const userId = request.headers['x-user-id'];
        if (typeof userId !== 'string') return reply.code(401).send({ error: 'Unauthorized' });
        request.userId = userId;
    });
    enableErrorHandlers(typed);
    publicSessionShareRoutes(typed);
    await app.ready();
    return app;
}

const snapshot = (attachmentId?: string) => ({
    version: 1,
    title: 'Shared session',
    sharedAt: 1_777_777_777_777,
    messages: [{
        id: 'message-1',
        role: 'assistant',
        createdAt: 1_777_777_777_000,
        blocks: attachmentId
            ? [{ type: 'attachment', attachmentId, kind: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', size: 5 }]
            : [{ type: 'text', markdown: 'Hello' }],
    }],
});
const coverSnapshot = (assetId: string, cover: Partial<{
    mimeType: string;
    size: number;
    width: number;
    height: number;
}> = {}) => ({
    version: 2,
    title: 'Shared session',
    sharedAt: 1_777_777_777_777,
    appearance: {
        themePack: 'sage',
        cover: {
            assetId,
            mimeType: 'image/jpeg',
            size: 5,
            width: 1_200,
            height: 600,
            ...cover,
        },
    },
    messages: [{
        id: 'message-1',
        role: 'assistant',
        createdAt: 1_777_777_777_000,
        blocks: [{ type: 'text', markdown: 'Hello' }],
    }],
});
const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';

describe('publicSessionShareRoutes', () => {
    let app: Awaited<ReturnType<typeof createApp>>;

    beforeEach(async () => {
        resetState();
        state.sessions.push({ id: 'session-1', accountId: 'owner-1' });
        app = await createApp();
    });
    afterEach(async () => app.close());

    async function createDraft(userId = 'owner-1') {
        return app.inject({ method: 'POST', url: '/v1/sessions/session-1/share/drafts', headers: { 'x-user-id': userId } });
    }

    it('allows only the session owner to create a draft', async () => {
        expect((await createDraft('other-user')).statusCode).toBe(404);
        const response = await createDraft();
        expect(response.statusCode).toBe(200);
        expect(response.json().generation).toMatch(/^[0-9a-f-]{36}$/);
        expect(response.json().publicId).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(dbMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    });

    it('returns a normalized random Pexels candidate only to the session owner', async () => {
        process.env.PEXELS_API_KEY = 'server-secret';

        const hidden = await app.inject({
            method: 'GET',
            url: '/v1/sessions/session-1/share/covers/random',
            headers: { 'x-user-id': 'other-user' },
        });
        const response = await app.inject({
            method: 'GET',
            url: '/v1/sessions/session-1/share/covers/random',
            headers: { 'x-user-id': 'owner-1' },
        });

        expect(hidden.statusCode).toBe(404);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            provider: 'pexels',
            photoId: 2014422,
            attribution: { photographer: 'Eberhard Grossgasteiger' },
        });
    });

    it('returns 503 for an unconfigured random provider without disabling other share routes', async () => {
        const unavailable = await app.inject({
            method: 'GET',
            url: '/v1/sessions/session-1/share/covers/random',
            headers: { 'x-user-id': 'owner-1' },
        });
        const share = await app.inject({
            method: 'GET',
            url: '/v1/sessions/session-1/share',
            headers: { 'x-user-id': 'owner-1' },
        });

        expect(unavailable.statusCode).toBe(503);
        expect(unavailable.json()).toEqual({ error: 'Random cover provider is unavailable' });
        expect(share.statusCode).toBe(200);
        expect(share.json()).toMatchObject({ active: false });
    });

    it('imports a canonical WebP into the pending generation outside a database transaction', async () => {
        process.env.PEXELS_API_KEY = 'server-secret';
        const draft = (await createDraft()).json();
        const hidden = await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/covers/import`,
            headers: { 'x-user-id': 'other-user' },
            payload: { assetId: '77777777-7777-4777-8777-777777777777', photoId: 2014422 },
        });
        expect(hidden.statusCode).toBe(404);
        let transactionActive = false;
        dbMock.$transaction.mockImplementation(async (callback: any) => {
            transactionActive = true;
            try {
                return await callback(dbMock);
            } finally {
                transactionActive = false;
            }
        });
        providerMock.importPexelsCover.mockImplementationOnce(async () => {
            expect(transactionActive).toBe(false);
            return {
                bytes: Buffer.from('webp'), mimeType: 'image/webp', size: 4, width: 2400, height: 900,
                attribution: {
                    photoId: 2014422,
                    photographer: 'Eberhard Grossgasteiger',
                    photographerUrl: 'https://www.pexels.com/@eberhardgross',
                    photoUrl: 'https://www.pexels.com/photo/brown-rocks-during-golden-hour-2014422/',
                },
            };
        });
        storageMock.putPublicShareAsset.mockImplementationOnce(async (path: string, bytes: Buffer) => {
            expect(transactionActive).toBe(false);
            state.bytes.set(path, bytes);
        });

        const response = await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/covers/import`,
            headers: { 'x-user-id': 'owner-1' },
            payload: { assetId: '77777777-7777-4777-8777-777777777777', photoId: 2014422 },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            assetId: '77777777-7777-4777-8777-777777777777',
            mimeType: 'image/webp',
            size: 4,
            width: 2400,
            height: 900,
            attribution: {
                photoId: 2014422,
                photographer: 'Eberhard Grossgasteiger',
                photographerUrl: 'https://www.pexels.com/@eberhardgross',
                photoUrl: 'https://www.pexels.com/photo/brown-rocks-during-golden-hour-2014422/',
            },
        });
        expect(state.assets).toHaveLength(1);
        expect(state.assets[0]).toMatchObject({
            id: '77777777-7777-4777-8777-777777777777',
            generation: draft.generation,
            mimeType: 'image/webp',
            kind: 'image',
            size: 4,
            sha256: 'a57bb082e728a0cdce930ecfcccf4510a3a247be5f322b09b3a971a3f5ed34f8',
            uploadedAt: expect.any(Date),
        });
        expect(state.bytes.get(state.assets[0].storagePath)).toEqual(Buffer.from('webp'));
    });

    it('removes only the imported object when the draft becomes stale during provider work', async () => {
        process.env.PEXELS_API_KEY = 'server-secret';
        const draft = (await createDraft()).json();
        const siblingPath = `private/session-shares/${state.shares[0].id}/${draft.generation}/sibling`;
        state.bytes.set(siblingPath, Buffer.from('attachment'));
        storageMock.putPublicShareAsset.mockImplementationOnce(async (path: string, bytes: Buffer) => {
            state.bytes.set(path, bytes);
            state.drafts[0].status = 'superseded';
        });

        const response = await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/covers/import`,
            headers: { 'x-user-id': 'owner-1' },
            payload: { assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', photoId: 2014422 },
        });

        expect(response.statusCode).toBe(409);
        expect(storageMock.deletePublicShareAsset).toHaveBeenCalledWith(
            `private/session-shares/${state.shares[0].id}/${draft.generation}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
        );
        expect(state.bytes.get(siblingPath)).toEqual(Buffer.from('attachment'));
        expect(state.assets).toHaveLength(0);
    });

    it('returns canonical metadata when the same imported asset ID is retried', async () => {
        process.env.PEXELS_API_KEY = 'server-secret';
        const draft = (await createDraft()).json();
        const request = {
            method: 'POST' as const,
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/covers/import`,
            headers: { 'x-user-id': 'owner-1' },
            payload: { assetId: '88888888-8888-4888-8888-888888888888', photoId: 2014422 },
        };

        const first = await app.inject(request);
        const retry = await app.inject(request);

        expect(first.statusCode).toBe(200);
        expect(retry.statusCode).toBe(200);
        expect(retry.json()).toEqual(first.json());
        expect(state.assets).toHaveLength(1);
    });

    it.each(['provider', 'storage'] as const)('leaves the draft unpublished when %s work fails', async (failure) => {
        process.env.PEXELS_API_KEY = 'server-secret';
        const draft = (await createDraft()).json();
        if (failure === 'provider') {
            providerMock.importPexelsCover.mockRejectedValueOnce(new providerMock.PexelsProviderError('provider unavailable'));
        } else {
            storageMock.putPublicShareAsset.mockRejectedValueOnce(new Error('object store unavailable'));
        }

        const response = await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/covers/import`,
            headers: { 'x-user-id': 'owner-1' },
            payload: { assetId: '99999999-9999-4999-8999-999999999999', photoId: 2014422 },
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(500);
        expect(state.shares[0].publishedAt).toBeNull();
        expect(state.drafts[0].status).toBe('pending');
        expect(state.assets).toHaveLength(0);
        if (failure === 'storage') {
            expect(storageMock.deletePublicShareAsset).toHaveBeenCalledWith(
                `private/session-shares/${state.shares[0].id}/${draft.generation}/99999999-9999-4999-8999-999999999999`,
            );
        }
    });

    it('retries a serializable quota transaction after a database write conflict', async () => {
        dbMock.$transaction.mockRejectedValueOnce(Object.assign(new Error('serialization conflict'), { code: 'P2034' }));

        const response = await createDraft();

        expect(response.statusCode).toBe(200);
        expect(dbMock.$transaction).toHaveBeenCalledTimes(2);
    });

    it('rejects arbitrary generations and attachment checksum mismatches', async () => {
        const draft = (await createDraft()).json();
        const arbitraryGeneration = '11111111-1111-4111-8111-111111111111';
        const arbitrary = await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${arbitraryGeneration}/assets`,
            headers: { 'x-user-id': 'owner-1' },
            payload: {
                attachmentId: '22222222-2222-4222-8222-222222222222',
                name: 'photo.jpg', mimeType: 'image/jpeg', kind: 'image', size: 5, sha256: HELLO_SHA256,
            },
        });
        expect(arbitrary.statusCode).toBe(409);

        const asset = (await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets`,
            headers: { 'x-user-id': 'owner-1' },
            payload: {
                attachmentId: '33333333-3333-4333-8333-333333333333',
                name: 'photo.jpg', mimeType: 'image/jpeg', kind: 'image', size: 5, sha256: 'a'.repeat(64),
            },
        })).json();
        const upload = await app.inject({
            method: 'PUT',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets/${asset.assetId}`,
            headers: { 'x-user-id': 'owner-1', 'content-type': 'application/octet-stream' },
            payload: Buffer.from('hello'),
        });
        expect(upload.statusCode).toBe(400);
        expect(upload.json().error).toContain('checksum');
    });

    it('keeps drafts private and publishes only after every manifest asset exists', async () => {
        const draft = (await createDraft()).json();
        const prepared = await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets`,
            headers: { 'x-user-id': 'owner-1' },
            payload: {
                attachmentId: '22222222-2222-4222-8222-222222222222',
                name: 'photo.jpg', mimeType: 'image/jpeg', kind: 'image', size: 5, sha256: HELLO_SHA256,
            },
        });
        expect(prepared.statusCode).toBe(200);
        expect(dbMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
        const asset = prepared.json();
        expect(asset.assetId).toBe('22222222-2222-4222-8222-222222222222');

        const privateDraft = await app.inject({ method: 'GET', url: `/v1/public/session-shares/${draft.publicId}` });
        expect(privateDraft.statusCode).toBe(404);
        expect(privateDraft.headers['cache-control']).toBe('no-store');
        expect(privateDraft.headers['x-robots-tag']).toContain('noindex');
        const beforeUpload = await app.inject({
            method: 'PUT',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' },
            payload: { snapshot: snapshot(asset.assetId) },
        });
        expect(beforeUpload.statusCode).toBe(409);

        const upload = await app.inject({
            method: 'PUT',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets/${asset.assetId}`,
            headers: { 'x-user-id': 'owner-1', 'content-type': 'application/octet-stream' },
            payload: Buffer.from('hello'),
        });
        expect(upload.statusCode).toBe(200);

        const publish = await app.inject({
            method: 'PUT',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' },
            payload: { snapshot: snapshot(asset.assetId) },
        });
        expect(publish.statusCode).toBe(200);

        const publicResponse = await app.inject({ method: 'GET', url: `/v1/public/session-shares/${draft.publicId}` });
        expect(publicResponse.statusCode).toBe(200);
        expect(publicResponse.json().snapshot).toEqual(snapshot(asset.assetId));
        expect(publicResponse.headers['cache-control']).toBe('no-store');
        expect(publicResponse.headers['x-robots-tag']).toContain('noindex');
    });

    it('publishes a cover that is the only asset in the manifest', async () => {
        const draft = (await createDraft()).json();
        const asset = (await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets`,
            headers: { 'x-user-id': 'owner-1' },
            payload: {
                attachmentId: '55555555-5555-4555-8555-555555555555',
                name: 'cover.jpg', mimeType: 'image/jpeg', kind: 'image', size: 5, sha256: HELLO_SHA256,
            },
        })).json();
        await app.inject({
            method: 'PUT',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets/${asset.assetId}`,
            headers: { 'x-user-id': 'owner-1', 'content-type': 'application/octet-stream' },
            payload: Buffer.from('hello'),
        });

        const publish = await app.inject({
            method: 'PUT',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' },
            payload: { snapshot: coverSnapshot(asset.assetId) },
        });

        expect(publish.statusCode).toBe(200);
    });

    it('rejects a cover whose registered asset object has not completed upload', async () => {
        const draft = (await createDraft()).json();
        const asset = (await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets`,
            headers: { 'x-user-id': 'owner-1' },
            payload: {
                attachmentId: '66666666-6666-4666-8666-666666666666',
                name: 'cover.jpg', mimeType: 'image/jpeg', kind: 'image', size: 5, sha256: HELLO_SHA256,
            },
        })).json();

        const publish = await app.inject({
            method: 'PUT',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' },
            payload: { snapshot: coverSnapshot(asset.assetId) },
        });

        expect(publish.statusCode).toBe(409);
        expect(publish.json()).toEqual({ error: 'Shared attachment upload incomplete' });
    });

    it.each([
        ['different MIME type', { kind: 'image', mimeType: 'image/jpeg', size: 5 }, { mimeType: 'image/png' }],
        ['different size', { kind: 'image', mimeType: 'image/jpeg', size: 5 }, { size: 6 }],
        ['non-image asset kind', { kind: 'file', mimeType: 'application/octet-stream', size: 5 }, { mimeType: 'application/octet-stream' }],
    ] as const)('rejects a cover with a %s from its registered asset', async (_reason, preparedAsset, cover) => {
        const draft = (await createDraft()).json();
        const asset = (await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets`,
            headers: { 'x-user-id': 'owner-1' },
            payload: {
                attachmentId: crypto.randomUUID(),
                name: 'cover.jpg',
                mimeType: preparedAsset.mimeType,
                kind: preparedAsset.kind,
                size: preparedAsset.size,
                sha256: HELLO_SHA256,
            },
        })).json();
        await app.inject({
            method: 'PUT',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets/${asset.assetId}`,
            headers: { 'x-user-id': 'owner-1', 'content-type': 'application/octet-stream' },
            payload: Buffer.from('hello'),
        });

        const publish = await app.inject({
            method: 'PUT',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' },
            payload: { snapshot: coverSnapshot(asset.assetId, cover) },
        });

        expect(publish.statusCode).toBe(409);
        expect(publish.json()).toEqual({ error: 'Shared attachment metadata mismatch' });
    });

    it('returns the active version-two appearance snapshot to its owner', async () => {
        const publishedAt = new Date();
        state.shares.push({
            id: 'share-appearance',
            publicId: 'a'.repeat(43),
            accountId: 'owner-1',
            sessionId: 'session-1',
            snapshot: {
                ...snapshot(),
                version: 2,
                appearance: { themePack: 'sage' },
            },
            activeGeneration: '11111111-1111-4111-8111-111111111111',
            publishedAt,
            revokedAt: null,
            lifecycleVersion: 1,
            createdAt: publishedAt,
            updatedAt: publishedAt,
        });

        const response = await app.inject({
            method: 'GET',
            url: '/v1/sessions/session-1/share',
            headers: { 'x-user-id': 'owner-1' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            active: true,
            appearance: { themePack: 'sage' },
        });
    });

    it('updates the snapshot at the same public URL', async () => {
        const first = (await createDraft()).json();
        await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${first.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' }, payload: { snapshot: snapshot() },
        });
        const second = (await createDraft()).json();
        expect(second.publicId).toBe(first.publicId);
        const nextSnapshot = { ...snapshot(), title: 'Updated snapshot' };
        await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${second.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' }, payload: { snapshot: nextSnapshot },
        });
        const publicResponse = await app.inject({ method: 'GET', url: `/v1/public/session-shares/${first.publicId}` });
        expect(publicResponse.json().snapshot.title).toBe('Updated snapshot');
    });

    it('revokes immediately and rotates the public id on the next draft', async () => {
        const draft = (await createDraft()).json();
        await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' }, payload: { snapshot: snapshot() },
        });
        let transactionActive = false;
        let cleanupMarkerWrittenInTransaction = false;
        dbMock.$transaction.mockImplementationOnce(async (callback: any, options: any) => {
            expect(options).toEqual({ isolationLevel: 'Serializable' });
            transactionActive = true;
            try {
                return await callback(dbMock);
            } finally {
                transactionActive = false;
            }
        });
        dbMock.publicSessionShareDraft.updateMany.mockImplementationOnce(async ({ where, data }: any) => {
            expect(transactionActive).toBe(true);
            cleanupMarkerWrittenInTransaction = data.status === 'revoked';
            const rows = state.drafts.filter((row) => row.shareId === where.shareId);
            rows.forEach((row) => Object.assign(row, data));
            return { count: rows.length };
        });
        expect((await app.inject({ method: 'DELETE', url: '/v1/sessions/session-1/share', headers: { 'x-user-id': 'owner-1' } })).statusCode).toBe(200);
        expect(cleanupMarkerWrittenInTransaction).toBe(true);
        expect((await app.inject({ method: 'GET', url: `/v1/public/session-shares/${draft.publicId}` })).statusCode).toBe(404);

        const next = (await createDraft()).json();
        expect(next.publicId).not.toBe(draft.publicId);
    });

    it('cannot resurrect a revoked link when revoke wins during publish validation', async () => {
        const draft = (await createDraft()).json();
        const asset = (await app.inject({
            method: 'POST', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets`,
            headers: { 'x-user-id': 'owner-1' }, payload: {
                attachmentId: '44444444-4444-4444-8444-444444444444',
                name: 'photo.jpg', mimeType: 'image/jpeg', kind: 'image', size: 5, sha256: HELLO_SHA256,
            },
        })).json();
        await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets/${asset.assetId}`,
            headers: { 'x-user-id': 'owner-1', 'content-type': 'application/octet-stream' }, payload: Buffer.from('hello'),
        });
        storageMock.publicShareAssetExists.mockImplementationOnce(async () => {
            const share = state.shares[0];
            share.revokedAt = new Date();
            share.lifecycleVersion += 1;
            return true;
        });

        const publish = await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' }, payload: { snapshot: snapshot(asset.assetId) },
        });

        expect(publish.statusCode).toBe(409);
        expect(state.shares[0].revokedAt).toBeInstanceOf(Date);
        expect(state.shares[0].publishedAt).toBeNull();
    });

    it('still revokes when publishing changes the lifecycle immediately before the revoke update', async () => {
        const draft = (await createDraft()).json();
        await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' }, payload: { snapshot: snapshot() },
        });
        dbMock.publicSessionShare.updateMany.mockImplementationOnce(async ({ where, data }: any) => {
            const share = state.shares[0];
            // Simulate a concurrent publish committing after DELETE read the
            // share but before its update reached the database.
            share.lifecycleVersion += 1;
            share.publishedAt = new Date();
            if (where.lifecycleVersion !== undefined && where.lifecycleVersion !== share.lifecycleVersion) return { count: 0 };
            if (where.revokedAt === null && share.revokedAt !== null) return { count: 0 };
            share.revokedAt = data.revokedAt;
            share.lifecycleVersion += data.lifecycleVersion.increment;
            return { count: 1 };
        });

        const revoke = await app.inject({
            method: 'DELETE', url: '/v1/sessions/session-1/share', headers: { 'x-user-id': 'owner-1' },
        });

        expect(revoke.statusCode).toBe(200);
        expect(state.shares[0].revokedAt).toBeInstanceOf(Date);
        expect((await app.inject({ method: 'GET', url: `/v1/public/session-shares/${draft.publicId}` })).statusCode).toBe(404);
    });

    it('serves safe attachment headers and hides unknown links behind the same 404', async () => {
        const draft = (await createDraft()).json();
        const asset = (await app.inject({
            method: 'POST', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets`,
            headers: { 'x-user-id': 'owner-1' }, payload: {
                attachmentId: '33333333-3333-4333-8333-333333333333',
                name: '../报告.pdf', mimeType: 'image/jpeg', kind: 'image', size: 5, sha256: HELLO_SHA256,
            },
        })).json();
        await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets/${asset.assetId}`,
            headers: { 'x-user-id': 'owner-1', 'content-type': 'application/octet-stream' }, payload: Buffer.from('hello'),
        });
        const unicodeSnapshot = snapshot(asset.assetId);
        const attachmentBlock = unicodeSnapshot.messages[0].blocks[0];
        if ('name' in attachmentBlock && attachmentBlock.type === 'attachment') attachmentBlock.name = '报告.pdf';
        await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' }, payload: { snapshot: unicodeSnapshot },
        });

        const response = await app.inject({ method: 'GET', url: `/v1/public/session-shares/${draft.publicId}/attachments/${asset.assetId}` });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('image/jpeg');
        expect(response.headers['content-disposition']).toContain("filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf");
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        const head = await app.inject({ method: 'HEAD', url: `/v1/public/session-shares/${draft.publicId}/attachments/${asset.assetId}` });
        expect(head.statusCode).toBe(200);
        expect(head.body).toBe('');
        expect((await app.inject({ method: 'GET', url: '/v1/public/session-shares/unknown' })).statusCode).toBe(404);
        expect((await app.inject({ method: 'GET', url: `/v1/public/session-shares/${draft.publicId}/attachments/unknown` })).statusCode).toBe(404);
        const overlong = await app.inject({ method: 'GET', url: `/v1/public/session-shares/${'x'.repeat(2_000)}` });
        expect(overlong.statusCode).toBe(404);
        expect(overlong.json()).toEqual({ error: 'Shared session not found' });
        expect(overlong.headers['cache-control']).toBe('no-store');
    });
});
