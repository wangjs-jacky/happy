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
    storagePath: string;
    createdAt: Date;
};

const { state, dbMock, storageMock, resetState } = vi.hoisted(() => {
    const state = {
        sessions: [] as Array<{ id: string; accountId: string }>,
        shares: [] as ShareRow[],
        assets: [] as AssetRow[],
        bytes: new Map<string, Buffer>(),
        nextShare: 1,
    };

    const matches = (value: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([key, wanted]) => {
        if (wanted && typeof wanted === 'object' && 'not' in wanted) return value[key] !== wanted.not;
        return value[key] === wanted;
    });

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
            Object.assign(row, data, { updatedAt: new Date() });
            return row;
        }),
    };
    const publicSessionShareAsset = {
        findMany: vi.fn(async ({ where }: any) => state.assets.filter((row) => matches(row, where))),
        findFirst: vi.fn(async ({ where }: any) => state.assets.find((row) => matches(row, where)) ?? null),
        create: vi.fn(async ({ data }: any) => {
            const row = { createdAt: new Date(), ...data } as AssetRow;
            state.assets.push(row);
            return row;
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
        publicSessionShareAsset,
    };
    dbMock.$transaction = vi.fn(async (callback: any) => callback(dbMock));

    const storageMock = {
        buildPublicShareStoragePath: vi.fn((shareId: string, generation: string, assetId: string) =>
            `public/session-shares/${shareId}/${generation}/${assetId}`),
        createPublicShareUploadDescriptor: vi.fn(async (_path: string, localUrl: string) => ({ method: 'PUT', uploadUrl: localUrl })),
        putPublicShareLocalAsset: vi.fn(async (path: string, bytes: Buffer) => { state.bytes.set(path, bytes); }),
        publicShareAssetExists: vi.fn(async (path: string, size: number) => state.bytes.get(path)?.length === size),
        getPublicShareDownloadSource: vi.fn(async (path: string) => {
            const data = state.bytes.get(path);
            if (!data) throw new Error('missing');
            return { kind: 'buffer' as const, data };
        }),
        deletePublicShareGeneration: vi.fn(async () => undefined),
    };

    const resetState = () => {
        state.sessions = [];
        state.shares = [];
        state.assets = [];
        state.bytes.clear();
        state.nextShare = 1;
        vi.clearAllMocks();
    };
    return { state, dbMock, storageMock, resetState };
});

vi.mock('@/storage/db', () => ({ db: dbMock }));
vi.mock('@/app/sessionSharing/publicSessionShareStorage', () => storageMock);

import { publicSessionShareRoutes } from './publicSessionShareRoutes';

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
    });

    it('keeps drafts private and publishes only after every manifest asset exists', async () => {
        const draft = (await createDraft()).json();
        const prepared = await app.inject({
            method: 'POST',
            url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets`,
            headers: { 'x-user-id': 'owner-1' },
            payload: {
                attachmentId: '22222222-2222-4222-8222-222222222222',
                name: 'photo.jpg', mimeType: 'image/jpeg', kind: 'image', size: 5,
            },
        });
        expect(prepared.statusCode).toBe(200);
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
        expect((await app.inject({ method: 'DELETE', url: '/v1/sessions/session-1/share', headers: { 'x-user-id': 'owner-1' } })).statusCode).toBe(200);
        expect((await app.inject({ method: 'GET', url: `/v1/public/session-shares/${draft.publicId}` })).statusCode).toBe(404);

        const next = (await createDraft()).json();
        expect(next.publicId).not.toBe(draft.publicId);
    });

    it('serves safe attachment headers and hides unknown links behind the same 404', async () => {
        const draft = (await createDraft()).json();
        const asset = (await app.inject({
            method: 'POST', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets`,
            headers: { 'x-user-id': 'owner-1' }, payload: {
                attachmentId: '33333333-3333-4333-8333-333333333333',
                name: '../photo.jpg', mimeType: 'image/jpeg', kind: 'image', size: 5,
            },
        })).json();
        await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/assets/${asset.assetId}`,
            headers: { 'x-user-id': 'owner-1', 'content-type': 'application/octet-stream' }, payload: Buffer.from('hello'),
        });
        await app.inject({
            method: 'PUT', url: `/v1/sessions/session-1/share/drafts/${draft.generation}/publish`,
            headers: { 'x-user-id': 'owner-1' }, payload: { snapshot: snapshot(asset.assetId) },
        });

        const response = await app.inject({ method: 'GET', url: `/v1/public/session-shares/${draft.publicId}/attachments/${asset.assetId}` });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('image/jpeg');
        expect(response.headers['content-disposition']).toContain('photo.jpg');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect((await app.inject({ method: 'GET', url: '/v1/public/session-shares/unknown' })).statusCode).toBe(404);
        expect((await app.inject({ method: 'GET', url: `/v1/public/session-shares/${draft.publicId}/attachments/unknown` })).statusCode).toBe(404);
    });
});
