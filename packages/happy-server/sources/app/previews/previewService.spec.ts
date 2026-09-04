import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewService, previewRowToEvent } from './previewService';

describe('createPreviewService publication', () => {
    it('returns fresh upload descriptors for the same canonical account-session draft without recreating its persisted asset key', async () => {
        const previewId = '12121212-1212-4121-8121-121212121212';
        const storageKey = 'private/interactive-previews/u1/12121212-1212-4121-8121-121212121212/generation-1/index';
        const manifest: any = { version: 1, previewId, title: 'Draft', assets: [{ id: 'index', path: 'index.html', size: 12, sha256: 'a'.repeat(64), mimeType: 'text/html' }] };
        const existing: any = { id: previewId, accountId: 'u1', sessionId: 's1', title: 'Draft', manifest, stagingGeneration: 'generation-1', assets: [{ ...manifest.assets[0], storageKey }] };
        const create = vi.fn(async () => existing);
        const createUpload = vi.fn(async () => ({ method: 'POST' as const, uploadUrl: 'https://oss.test/fresh', formFields: { key: 'fresh' } }));
        const database: any = { session: { findFirst: vi.fn(async () => ({ id: 's1' })) }, interactivePreview: { findUnique: vi.fn(async () => existing), create } };
        const service = createPreviewService({ database, storage: { storageKey: vi.fn(() => storageKey), createUpload } as any, credentialStore: {} as any, clientFactory: vi.fn() as any });

        await expect(service.createDraft('u1', 's1', manifest)).resolves.toEqual({
            previewId,
            uploads: [{ assetId: 'index', method: 'POST', uploadUrl: 'https://oss.test/fresh', formFields: { key: 'fresh' } }],
        });

        expect(create).not.toHaveBeenCalled();
        expect(createUpload).toHaveBeenCalledWith(storageKey, 12);
    });

    it.each([
        ['a different account', { accountId: 'u2', sessionId: 's1' }],
        ['a different session', { accountId: 'u1', sessionId: 's2' }],
    ])('rejects a reused preview id from %s without revealing the existing draft', async (_label, owner) => {
        const previewId = '13131313-1313-4131-8131-131313131313';
        const manifest: any = { version: 1, previewId, title: 'Draft', assets: [{ id: 'index', path: 'index.html', size: 12, sha256: 'a'.repeat(64), mimeType: 'text/html' }] };
        const existing: any = { id: previewId, ...owner, manifest, assets: [] };
        const create = vi.fn(async () => { throw Object.assign(new Error('Unique constraint violation'), { code: 'P2002' }); });
        const database: any = { session: { findFirst: vi.fn(async () => ({ id: 's1' })) }, interactivePreview: { findUnique: vi.fn(async () => existing), create } };
        const service = createPreviewService({ database, storage: { storageKey: vi.fn(), createUpload: vi.fn() } as any, credentialStore: {} as any, clientFactory: vi.fn() as any });

        await expect(service.createDraft('u1', 's1', manifest)).rejects.toThrow('Preview not found');
        expect(create).not.toHaveBeenCalled();
    });

    it('uses the persisted asset storage key only after matching the account and session for completion', async () => {
        const previewId = '14141414-1414-4141-8141-141414141414';
        const storageKey = 'private/interactive-previews/u1/14141414-1414-4141-8141-141414141414/generation-1/index';
        const findFirst = vi.fn(async () => ({ assets: [{ id: 'index', size: 12, storageKey }] }));
        const assertUploaded = vi.fn(async () => {});
        const database: any = { interactivePreview: { findFirst }, interactivePreviewAsset: { update: vi.fn(async () => {}) } };
        const service = createPreviewService({ database, storage: { assertUploaded } as any, credentialStore: {} as any, clientFactory: vi.fn() as any });

        await service.completeAsset('u1', 's1', previewId, 'index');

        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: previewId, accountId: 'u1', sessionId: 's1', status: 'draft' } }));
        expect(assertUploaded).toHaveBeenCalledWith(storageKey, 12);
    });

    it('lists only previews belonging to the requested account and session', async () => {
        const findMany = vi.fn(async () => []);
        const service = createPreviewService({ database: { interactivePreview: { findMany } } as any, storage: {} as any, credentialStore: {} as any, clientFactory: vi.fn() as any });

        await expect(service.list('u1', 's1')).resolves.toEqual([]);

        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'u1', sessionId: 's1' } }));
    });

    it('projects a deleting tombstone as an expired preview without its URL', () => {
        expect(previewRowToEvent({ id: '00000000-0000-4000-8000-000000000000', title: 'Deleted', status: 'deleting', url: 'https://must-not-leak.test', publishedAt: null, expiresAt: new Date(0), errorCode: null })).toMatchObject({ state: 'expired' });
        expect(previewRowToEvent({ id: '00000000-0000-4000-8000-000000000000', title: 'Deleted', status: 'deleting', url: 'https://must-not-leak.test', publishedAt: null, expiresAt: new Date(0), errorCode: null })).not.toHaveProperty('url');
    });
    it('returns the current publishing event for a duplicate in-flight publish request', async () => {
        const row: any = { id: '99999999-9999-4999-8999-999999999999', accountId: 'u1', sessionId: 's1', title: 'Draft', status: 'publishing', url: null, publishedAt: null, expiresAt: new Date('2026-09-05T00:00:00Z'), errorCode: null, assets: [] };
        const database: any = { interactivePreview: { findFirst: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: 0 })) } };
        const service = createPreviewService({ database, storage: {} as any, credentialStore: {} as any, clientFactory: vi.fn() as any });

        await expect(service.publish('u1', 's1', row.id)).resolves.toMatchObject({ id: row.id, state: 'publishing' });
    });

    it('turns an explicit delete into a retryable tombstone when credentials are unavailable', async () => {
        const row: any = { id: '77777777-7777-4777-8777-777777777777', accountId: 'u1', sessionId: 's1', status: 'ready', vercelDeploymentId: 'dpl_7' };
        const updateMany = vi.fn(async () => ({ count: 1 }));
        const database: any = { interactivePreview: { findFirst: vi.fn(async () => row), updateMany, delete: vi.fn() } };
        const storage = { deletePreview: vi.fn() } as any;
        const service = createPreviewService({ database, storage, credentialStore: { get: vi.fn(async () => null) } as any, clientFactory: vi.fn() as any });

        await expect(service.delete('u1', 's1', row.id)).resolves.toBeUndefined();

        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: row.id, accountId: 'u1', sessionId: 's1' }, data: expect.objectContaining({ status: 'deleting', url: null }),
        }));
        expect(database.interactivePreview.delete).not.toHaveBeenCalled();
        expect(storage.deletePreview).not.toHaveBeenCalled();
    });

    it('makes deleting an already removed preview idempotent', async () => {
        const database: any = { interactivePreview: { findFirst: vi.fn(async () => null), updateMany: vi.fn(), delete: vi.fn() } };
        const service = createPreviewService({ database, storage: { deletePreview: vi.fn() } as any, credentialStore: { get: vi.fn() } as any, clientFactory: vi.fn() as any });

        await expect(service.delete('u1', 's1', '88888888-8888-4888-8888-888888888888')).resolves.toBeUndefined();
    });

    it('does not publish when atomic project persistence loses a reconnect or disconnect race', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '66666666-6666-4666-8666-666666666666', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/66666666-6666-4666-8666-666666666666/generation-1/index', uploadedAt: new Date() }] };
        const database: any = { interactivePreview: {
            findFirst: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(async ({ data }: any) => Object.assign(row, data)),
        } };
        const createDeployment = vi.fn();
        const service = createPreviewService({ database, storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: {
                get: vi.fn(async () => ({ version: 1, accessToken: 'token-a', configurationId: 'icfg', teamId: 'team-1' })),
                setProjectIdIfCurrent: vi.fn(async () => false),
            } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_happy' })), uploadFile: vi.fn(), createDeployment })) as any });

        await expect(service.publish('u1', 's1', row.id)).rejects.toThrow(/connection changed/i);
        expect(createDeployment).not.toHaveBeenCalled();
    });

    it('rejects an agent-supplied Vercel configuration before it can override Happy no-index headers', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '55555555-5555-4555-8555-555555555555', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, assets: [
                { id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/55555555-5555-4555-8555-555555555555/generation-1/index', uploadedAt: new Date() },
                { id: 'config', path: 'vercel.json', mimeType: 'application/json', size: 2, sha256: 'a'.repeat(64), storageKey: 'private/interactive-previews/u1/55555555-5555-4555-8555-555555555555/generation-1/config', uploadedAt: new Date() },
            ] };
        const database: any = { interactivePreview: { findFirst: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn() } };
        const uploadFile = vi.fn(async () => {});
        const service = createPreviewService({ database, storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg' })), setProjectIdIfCurrent: vi.fn(async () => true) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_happy' })), uploadFile, createDeployment: vi.fn() })) as any });

        await expect(service.publish('u1', 's1', row.id)).rejects.toThrow(/vercel\.json/i);
        expect(uploadFile).not.toHaveBeenCalled();
    });

    it('uploads a Happy-owned no-index Vercel configuration and deploys its SHA reference', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '44444444-4444-4444-8444-444444444444', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/44444444-4444-4444-8444-444444444444/generation-1/index', uploadedAt: new Date() }] };
        const database: any = { interactivePreview: {
            findFirst: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: 1 })),
            update: vi.fn(async ({ data }: any) => Object.assign(row, data)),
        } };
        const uploadFile = vi.fn(async (_sha: string, _bytes: Uint8Array, _mimeType: string) => {});
        const createDeployment = vi.fn(async (input: any) => {
            await input.onCreated({ id: 'dpl_1' });
            return { id: 'dpl_1', url: 'https://draft.vercel.app', readyState: 'READY' };
        });
        const service = createPreviewService({ database, storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg' })), setProjectIdIfCurrent: vi.fn(async () => true) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_happy' })), uploadFile, createDeployment })) as any });

        await service.publish('u1', 's1', row.id);

        const configUpload = uploadFile.mock.calls.find(([, uploaded, mimeType]) => mimeType === 'application/json' && new TextDecoder().decode(uploaded).includes('X-Robots-Tag'));
        expect(configUpload).toBeDefined();
        const [configSha, configBytes] = configUpload!;
        expect(JSON.parse(new TextDecoder().decode(configBytes))).toEqual({ headers: [{ source: '/(.*)', headers: [
            { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'no-referrer' },
        ] }] });
        expect(createDeployment).toHaveBeenCalledWith(expect.objectContaining({ files: expect.arrayContaining([
            { file: 'vercel.json', sha: configSha, size: configBytes.byteLength },
        ]) }));
    });

    it('persists a newly provisioned account project before reusing it for a deployment', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '33333333-3333-4333-8333-333333333333', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/33333333-3333-4333-8333-333333333333/generation-1/index', uploadedAt: new Date() }] };
        const database: any = { interactivePreview: {
            findFirst: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: 1 })),
            update: vi.fn(async ({ data }: any) => Object.assign(row, data)),
        } };
        const credential = { version: 1 as const, accessToken: 'secret', configurationId: 'icfg_123' };
        const setProjectIdIfCurrent = vi.fn(async () => true); const ensurePreviewProject = vi.fn(async () => ({ id: 'prj_happy' }));
        const createDeployment = vi.fn(async (input: any) => {
            await input.onCreated({ id: 'dpl_1' });
            return { id: 'dpl_1', url: 'https://draft.vercel.app', readyState: 'READY' };
        });
        const service = createPreviewService({ database, storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn(async () => credential), setProjectIdIfCurrent } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject, uploadFile: vi.fn(), createDeployment })) as any });

        await service.publish('u1', 's1', row.id);

        expect(setProjectIdIfCurrent).toHaveBeenCalledWith('u1', credential, 'prj_happy');
        expect(createDeployment).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'prj_happy' }));
    });

    it('verifies bytes, uploads sequentially, creates a non-production deployment, persists expiry, then removes staging', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '11111111-1111-4111-8111-111111111111', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date('2026-09-04T01:00:00Z'), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/11111111-1111-4111-8111-111111111111/generation-1/index', uploadedAt: new Date() }] };
        const database: any = { interactivePreview: {
            findFirst: vi.fn(async () => row), updateMany: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }),
            findMany: vi.fn(), create: vi.fn(), delete: vi.fn(),
        }, session: { findFirst: vi.fn() }, interactivePreviewAsset: { update: vi.fn() } };
        const storage: any = { read: vi.fn(async () => bytes), deletePreview: vi.fn(async () => {}), storageKey: vi.fn(), createUpload: vi.fn(), assertUploaded: vi.fn() };
        const uploadFile = vi.fn(async () => {});
        const createDeployment = vi.fn(async (input: any) => {
            await input.onCreated({ id: 'dpl_1' });
            return { id: 'dpl_1', url: 'https://draft.vercel.app', readyState: 'READY' };
        });
        const service = createPreviewService({ database, storage, credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg' })), setProjectIdIfCurrent: vi.fn(async () => true) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_happy' })), uploadFile, createDeployment, deleteDeployment: vi.fn() })) as any, now: () => new Date('2026-09-04T02:00:00Z') });
        const result = await service.publish('u1', 's1', row.id);
        expect(uploadFile).toHaveBeenCalledWith(sha256, bytes, 'text/html');
        expect(createDeployment.mock.calls[0][0]).toMatchObject({ files: expect.arrayContaining([{ file: 'index.html', sha: sha256, size: bytes.length }]) });
        expect(database.interactivePreview.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: { vercelDeploymentId: 'dpl_1' } }));
        expect(database.interactivePreview.updateMany).toHaveBeenNthCalledWith(3, expect.objectContaining({ data: expect.objectContaining({ status: 'ready', vercelDeploymentId: 'dpl_1', expiresAt: new Date('2026-09-05T02:00:00Z') }) }));
        expect(storage.deletePreview).toHaveBeenCalledWith({ accountId: 'u1', previewId: row.id, stagingGeneration: 'generation-1' });
        expect(storage.deletePreview).toHaveBeenCalledAfter(database.interactivePreview.updateMany);
        expect(result).toMatchObject({ state: 'ready', url: 'https://draft.vercel.app', expiresAt: new Date('2026-09-05T02:00:00Z').getTime() });
    });

    it('retains a created deployment id when final persistence fails so cleanup can remove it', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '22222222-2222-4222-8222-222222222222', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null,
            publishedAt: null, expiresAt: new Date(), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/22222222-2222-4222-8222-222222222222/generation-1/index', uploadedAt: new Date() }] };
        const updateMany = vi.fn()
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 1 })
            .mockRejectedValueOnce(new Error('database unavailable'))
            .mockResolvedValueOnce({ count: 1 });
        const database: any = { interactivePreview: {
            findFirst: vi.fn(async () => row), updateMany,
        } };
        const service = createPreviewService({
            database,
            storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg' })), setProjectIdIfCurrent: vi.fn(async () => true) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_happy' })), uploadFile: vi.fn(), createDeployment: vi.fn(async (input: any) => {
                await input.onCreated({ id: 'dpl_orphan' });
                return { id: 'dpl_orphan', url: 'https://draft.vercel.app' };
            }) })) as any,
        });

        await expect(service.publish('u1', 's1', row.id)).rejects.toThrow('database unavailable');
        expect(updateMany).toHaveBeenNthCalledWith(4, expect.objectContaining({ data: expect.objectContaining({ status: 'failed', vercelDeploymentId: 'dpl_orphan' }) }));
    });
});
