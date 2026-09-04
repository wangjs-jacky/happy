import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewService } from './previewService';

describe('createPreviewService publication', () => {
    it('does not publish when atomic project persistence loses a reconnect or disconnect race', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '66666666-6666-4666-8666-666666666666', accountId: 'u1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, uploadedAt: new Date() }] };
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

        await expect(service.publish('u1', row.id)).rejects.toThrow(/connection changed/i);
        expect(createDeployment).not.toHaveBeenCalled();
    });

    it('rejects an agent-supplied Vercel configuration before it can override Happy no-index headers', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '55555555-5555-4555-8555-555555555555', accountId: 'u1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, assets: [
                { id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, uploadedAt: new Date() },
                { id: 'config', path: 'vercel.json', mimeType: 'application/json', size: 2, sha256: 'a'.repeat(64), uploadedAt: new Date() },
            ] };
        const database: any = { interactivePreview: { findFirst: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn() } };
        const uploadFile = vi.fn(async () => {});
        const service = createPreviewService({ database, storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg' })), setProjectIdIfCurrent: vi.fn(async () => true) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_happy' })), uploadFile, createDeployment: vi.fn() })) as any });

        await expect(service.publish('u1', row.id)).rejects.toThrow(/vercel\.json/i);
        expect(uploadFile).not.toHaveBeenCalled();
    });

    it('uploads a Happy-owned no-index Vercel configuration and deploys its SHA reference', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '44444444-4444-4444-8444-444444444444', accountId: 'u1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, uploadedAt: new Date() }] };
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

        await service.publish('u1', row.id);

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
        const row: any = { id: '33333333-3333-4333-8333-333333333333', accountId: 'u1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, uploadedAt: new Date() }] };
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

        await service.publish('u1', row.id);

        expect(setProjectIdIfCurrent).toHaveBeenCalledWith('u1', credential, 'prj_happy');
        expect(createDeployment).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'prj_happy' }));
    });

    it('verifies bytes, uploads sequentially, creates a non-production deployment, persists expiry, then removes staging', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '11111111-1111-4111-8111-111111111111', accountId: 'u1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date('2026-09-04T01:00:00Z'), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, uploadedAt: new Date() }] };
        const database: any = { interactivePreview: {
            findFirst: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: 1 })),
            update: vi.fn(async ({ data }: any) => Object.assign(row, data)), findMany: vi.fn(), create: vi.fn(), delete: vi.fn(),
        }, session: { findFirst: vi.fn() }, interactivePreviewAsset: { update: vi.fn() } };
        const storage: any = { read: vi.fn(async () => bytes), deletePreview: vi.fn(async () => {}), storageKey: vi.fn(), createUpload: vi.fn(), assertUploaded: vi.fn() };
        const uploadFile = vi.fn(async () => {});
        const createDeployment = vi.fn(async (input: any) => {
            await input.onCreated({ id: 'dpl_1' });
            return { id: 'dpl_1', url: 'https://draft.vercel.app', readyState: 'READY' };
        });
        const service = createPreviewService({ database, storage, credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg' })), setProjectIdIfCurrent: vi.fn(async () => true) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_happy' })), uploadFile, createDeployment, deleteDeployment: vi.fn() })) as any, now: () => new Date('2026-09-04T02:00:00Z') });
        const result = await service.publish('u1', row.id);
        expect(uploadFile).toHaveBeenCalledWith(sha256, bytes, 'text/html');
        expect(createDeployment.mock.calls[0][0]).toMatchObject({ files: expect.arrayContaining([{ file: 'index.html', sha: sha256, size: bytes.length }]) });
        expect(database.interactivePreview.update.mock.calls[0][0].data).toMatchObject({ vercelDeploymentId: 'dpl_1' });
        expect(database.interactivePreview.update.mock.calls[1][0].data).toMatchObject({ status: 'ready', vercelDeploymentId: 'dpl_1', expiresAt: new Date('2026-09-05T02:00:00Z') });
        expect(storage.deletePreview).toHaveBeenCalledAfter(database.interactivePreview.update);
        expect(result).toMatchObject({ state: 'ready', url: 'https://draft.vercel.app', expiresAt: new Date('2026-09-05T02:00:00Z').getTime() });
    });

    it('retains a created deployment id when final persistence fails so cleanup can remove it', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: '22222222-2222-4222-8222-222222222222', accountId: 'u1', title: 'Draft', status: 'draft', url: null,
            publishedAt: null, expiresAt: new Date(), errorCode: null, assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, uploadedAt: new Date() }] };
        const update = vi.fn()
            .mockRejectedValueOnce(new Error('database unavailable'))
            .mockImplementationOnce(async ({ data }: any) => Object.assign(row, data));
        const database: any = { interactivePreview: {
            findFirst: vi.fn(async () => row), updateMany: vi.fn(async () => ({ count: 1 })), update,
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

        await expect(service.publish('u1', row.id)).rejects.toThrow('database unavailable');
        expect(update.mock.calls[1][0].data).toMatchObject({ status: 'failed', vercelDeploymentId: 'dpl_orphan' });
    });
});
