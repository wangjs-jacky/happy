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
            where: expect.objectContaining({ id: row.id, accountId: 'u1', sessionId: 's1', status: { in: ['draft', 'uploading', 'publishing', 'failed', 'ready'] } }),
            data: expect.objectContaining({ status: 'deleting', url: null, publicationGeneration: { increment: 1 } }),
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
        expect(database.interactivePreview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { vercelDeploymentId: 'dpl_1' } }));
        expect(database.interactivePreview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ready', vercelDeploymentId: 'dpl_1', expiresAt: new Date('2026-09-05T02:00:00Z') }) }));
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
            .mockResolvedValueOnce({ count: 1 })
            .mockRejectedValueOnce(new Error('database unavailable'))
            .mockResolvedValueOnce({ count: 1 })
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
        expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { vercelDeploymentId: 'dpl_orphan' } }));
        expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'publishing', errorCode: 'PUBLISH_RECONCILIATION_PENDING' }) }));
    });

    it('does not issue another deployment create for an inconclusive persisted attempt', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'failed', url: null, publishedAt: null,
            expiresAt: new Date('2026-09-04T01:00:00Z'), errorCode: 'PUBLISH_LEASE_EXPIRED', publicationAttemptId: 'attempt-1', publicationCreateStartedAt: new Date('2026-09-04T00:00:00Z'), publicationGeneration: 1, connectionGeneration: 0, vercelDeploymentId: null,
            assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generation-1/index', uploadedAt: new Date() }] };
        const updateMany = vi.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; });
        const createDeployment = vi.fn(async () => { throw new Error('must not create a second deployment'); });
        const database: any = { interactivePreview: { findFirst: vi.fn(async () => row), updateMany } };
        const service = createPreviewService({ database, storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg', projectId: 'prj_1' })) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_1' })), uploadFile: vi.fn(), createDeployment })) as any,
            now: () => new Date('2026-09-04T02:00:00Z') });

        await expect(service.publish('u1', 's1', row.id)).resolves.toMatchObject({ state: 'failed' });

        expect(createDeployment).not.toHaveBeenCalled();
    });

    it('does not allow a publisher fenced by delete to restore a preview to ready', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, publicationAttemptId: null, publicationGeneration: 0, connectionGeneration: 0, vercelDeploymentId: null, cleanupClaimedAt: null,
            assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/generation-1/index', uploadedAt: new Date() }] };
        const matches = (where: any): boolean => {
            if (where.id && row.id !== where.id || where.accountId && row.accountId !== where.accountId || where.sessionId && row.sessionId !== where.sessionId) return false;
            if (where.status?.in && !where.status.in.includes(row.status) || typeof where.status === 'string' && where.status !== row.status) return false;
            for (const key of ['publicationAttemptId', 'publicationGeneration', 'connectionGeneration', 'vercelDeploymentId', 'cleanupClaimedAt']) if (key in where && row[key] !== where[key]) return false;
            return !where.OR || where.OR.some((candidate: any) => matches({ ...candidate, id: row.id, accountId: row.accountId, sessionId: row.sessionId, status: row.status, publicationAttemptId: row.publicationAttemptId, publicationGeneration: row.publicationGeneration, connectionGeneration: row.connectionGeneration }));
        };
        const updateMany = vi.fn(async ({ where, data }: any) => {
            if (!matches(where)) return { count: 0 };
            Object.entries(data).forEach(([key, value]: any) => { row[key] = value?.increment === undefined ? value : row[key] + value.increment; });
            return { count: 1 };
        });
        let release!: () => void;
        const createDeployment = vi.fn(async (input: any) => {
            await new Promise<void>((resolve) => { release = resolve; });
            await input.onCreated({ id: 'dpl_fenced' });
            return { id: 'dpl_fenced', url: 'https://fenced.vercel.app', readyState: 'READY' };
        });
        const deleteDeployment = vi.fn(async () => {});
        const database: any = { interactivePreview: { findFirst: vi.fn(async () => row), updateMany } };
        const service = createPreviewService({ database, storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg', projectId: 'prj_1' })) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_1' })), uploadFile: vi.fn(), lookupDeploymentByMetadata: vi.fn(async () => ({ visibility: 'not_found' })), createDeployment, deleteDeployment })) as any });

        const publication = service.publish('u1', 's1', row.id);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await service.delete('u1', 's1', row.id);
        release();

        await expect(publication).rejects.toThrow(/fenced/i);
        expect(row).toMatchObject({ status: 'expired', url: null, vercelDeploymentId: null, publicationAttemptId: null, publicationCreateStartedAt: null });
        expect(deleteDeployment).toHaveBeenCalledWith('dpl_fenced');
    });

    it('keeps a different cleanup worker claim and its retry deadline through repeated delete and disconnect', async () => {
        const claimedAt = new Date('2026-09-04T01:00:00Z');
        const retryAt = new Date('2026-09-04T02:00:00Z');
        const row: any = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', accountId: 'u1', sessionId: 's1', status: 'deleting', url: null, stagingGeneration: 'generation-1',
            vercelDeploymentId: 'dpl_claimed', cleanupClaimedAt: claimedAt, cleanupNextAttemptAt: retryAt };
        const updateMany = vi.fn(async () => ({ count: 0 }));
        const database: any = { interactivePreview: { findFirst: vi.fn(async () => row), findMany: vi.fn(async () => [row]), updateMany } };
        const credentialStore: any = { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg', projectId: 'prj_1' })), delete: vi.fn(async () => {}) };
        const service = createPreviewService({ database, storage: { deletePreview: vi.fn() } as any, credentialStore, clientFactory: vi.fn() as any });

        await service.delete('u1', 's1', row.id);
        await service.disconnectVercel('u1');

        expect(row.cleanupClaimedAt).toBe(claimedAt);
        expect(row.cleanupNextAttemptAt).toBe(retryAt);
        expect(credentialStore.delete).toHaveBeenCalledWith('u1');
        expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cleanupClaimedAt: null }) }));
    });

    it('reconciles an active publication attempt before disconnecting its credential', async () => {
        const row: any = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', accountId: 'u1', sessionId: 's1', status: 'publishing', url: null, stagingGeneration: 'generation-1',
            publicationAttemptId: 'attempt-1', publicationGeneration: 1, connectionGeneration: 0, vercelDeploymentId: null, cleanupClaimedAt: null, cleanupNextAttemptAt: null };
        const updateMany = vi.fn(async ({ where, data }: any) => {
            if (where.status?.in && !where.status.in.includes(row.status) || typeof where.status === 'string' && where.status !== row.status) return { count: 0 };
            if ('vercelDeploymentId' in where && row.vercelDeploymentId !== where.vercelDeploymentId) return { count: 0 };
            if ('cleanupClaimedAt' in where && row.cleanupClaimedAt !== where.cleanupClaimedAt) return { count: 0 };
            Object.entries(data).forEach(([key, value]: any) => { row[key] = value?.increment === undefined ? value : row[key] + value.increment; });
            return { count: 1 };
        });
        const lookupDeploymentByMetadata = vi.fn(async () => ({ visibility: 'ready', deployment: { id: 'dpl_reconciled', url: 'https://reconciled.vercel.app', readyState: 'READY' } }));
        const deleteDeployment = vi.fn(async () => {});
        const deletePreview = vi.fn(async () => {});
        const credentialStore: any = { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg', projectId: 'prj_1' })), delete: vi.fn(async () => {}) };
        const database: any = { interactivePreview: { updateMany, findMany: vi.fn(async () => [row]) } };
        const service = createPreviewService({ database, storage: { deletePreview } as any, credentialStore,
            clientFactory: vi.fn(() => ({ lookupDeploymentByMetadata, deleteDeployment })) as any });

        await expect(service.disconnectVercel('u1')).resolves.toEqual({});

        expect(lookupDeploymentByMetadata).toHaveBeenCalledWith({ projectId: 'prj_1', happyPreviewId: row.id, publicationAttemptId: 'attempt-1' });
        expect(deleteDeployment).toHaveBeenCalledWith('dpl_reconciled');
        expect(deletePreview).toHaveBeenCalledWith({ accountId: 'u1', previewId: row.id, stagingGeneration: 'generation-1' });
        expect(credentialStore.delete).toHaveBeenCalledAfter(deleteDeployment);
        expect(row).toMatchObject({ status: 'expired', vercelDeploymentId: null });
    });

    it('keeps a ready deployment and persists staging cleanup pending when post-publication OSS removal fails', async () => {
        const bytes = Buffer.from('<h1>x</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date(), errorCode: null, publicationAttemptId: null, publicationGeneration: 0, connectionGeneration: 0, vercelDeploymentId: null, cleanupClaimedAt: null,
            assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/generation-1/index', uploadedAt: new Date() }] };
        const database: any = { interactivePreview: {
            findFirst: vi.fn(async () => row),
            updateMany: vi.fn(async ({ data }: any) => { Object.entries(data).forEach(([key, value]: any) => { row[key] = value?.increment === undefined ? value : row[key] + value.increment; }); return { count: 1 }; }),
        } };
        const service = createPreviewService({ database, storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn(async () => { throw new Error('oss unavailable'); }) } as any,
            credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'secret', configurationId: 'icfg', projectId: 'prj_1' })) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj_1' })), lookupDeploymentByMetadata: vi.fn(async () => ({ visibility: 'not_found' })), uploadFile: vi.fn(), createDeployment: vi.fn(async (input: any) => { await input.onCreated({ id: 'dpl_ready' }); return { id: 'dpl_ready', url: 'https://ready.vercel.app', readyState: 'READY' }; }) })) as any });

        await expect(service.publish('u1', 's1', row.id)).resolves.toMatchObject({ state: 'ready', url: 'https://ready.vercel.app' });

        expect(row).toMatchObject({ status: 'ready', vercelDeploymentId: 'dpl_ready', stagingCleanupPending: true, cleanupNextAttemptAt: null });
    });
});
