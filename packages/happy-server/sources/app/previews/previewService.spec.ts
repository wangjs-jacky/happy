import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewService, previewRowToEvent } from './previewService';
import { createVercelCredentialStore } from './vercelCredentialStore';

describe('createPreviewService publication', () => {
    it('returns fresh upload descriptors for the same canonical account-session draft without recreating its persisted asset key', async () => {
        const previewId = '12121212-1212-4121-8121-121212121212';
        const storageKey = 'private/interactive-previews/u1/12121212-1212-4121-8121-121212121212/generation-1/index';
        const manifest: any = { version: 1, previewId, title: 'Draft', assets: [{ id: 'index', path: 'index.html', size: 12, sha256: 'a'.repeat(64), mimeType: 'text/html' }] };
        const existing: any = { id: previewId, accountId: 'u1', sessionId: 's1', title: 'Draft', status: 'draft', expiresAt: new Date('2026-09-05T00:00:00.000Z'), cleanupClaimedAt: null, manifest, stagingGeneration: 'generation-1', assets: [{ ...manifest.assets[0], storageKey }] };
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

    it('holds the active account fence until a new draft has been inserted', async () => {
        const previewId = '11111111-1111-4111-8111-111111111111';
        const manifest: any = { version: 1, previewId, title: 'Draft', assets: [{ id: 'index', path: 'index.html', size: 12, sha256: 'a'.repeat(64), mimeType: 'text/html' }] };
        let accountFenceHeld = false;
        const created: any = { id: previewId, accountId: 'u1', sessionId: 's1', status: 'draft', expiresAt: new Date('2026-09-05T00:00:00Z'), cleanupClaimedAt: null, manifest, stagingGeneration: 'generation-1', assets: [{ ...manifest.assets[0], storageKey: 'private/interactive-previews/u1/11111111-1111-4111-8111-111111111111/generation-1/index' }] };
        const create = vi.fn(async () => {
            if (!accountFenceHeld) throw new Error('draft insert escaped its account fence');
            return created;
        });
        const database: any = {
            session: { findFirst: vi.fn(async () => ({ id: 's1' })) },
            account: { findUnique: vi.fn(async () => ({ vercelConnectionEpoch: 0, vercelConnectionState: 'active' })), updateMany: vi.fn(async () => ({ count: 0 })) },
            interactivePreview: { findUnique: vi.fn(async () => null), create },
            $transaction: vi.fn(async (work: any) => work({
                session: { findFirst: vi.fn(async () => ({ id: 's1' })) },
                account: {
                    findUnique: vi.fn(async () => ({ vercelConnectionEpoch: 0, vercelConnectionState: 'active' })),
                    updateMany: vi.fn(async () => { accountFenceHeld = true; return { count: 1 }; }),
                },
                interactivePreview: { findUnique: vi.fn(async () => null), create },
            })),
        };
        const service = createPreviewService({
            database, storage: { storageKey: vi.fn(() => created.assets[0].storageKey), createUpload: vi.fn(async () => ({ method: 'POST', uploadUrl: 'https://oss.test/upload', formFields: {} })) } as any,
            credentialStore: {} as any, clientFactory: vi.fn() as any,
        });

        await expect(service.createDraft('u1', 's1', manifest)).resolves.toMatchObject({ previewId });
        expect(database.$transaction).toHaveBeenCalledOnce();
    });

    it.each([
        ['expired', 'draft', new Date('2026-09-04T00:00:00.000Z'), null],
        ['deleting', 'deleting', new Date('2026-09-04T02:00:00.000Z'), null],
        ['cleanup-claimed', 'draft', new Date('2026-09-04T02:00:00.000Z'), new Date('2026-09-04T01:00:00.000Z')],
    ])('does not reissue upload descriptors for a %s persisted draft', async (_label, status, expiresAt, cleanupClaimedAt) => {
        const previewId = '15151515-1515-4151-8151-151515151515';
        const manifest: any = { version: 1, previewId, title: 'Draft', assets: [{ id: 'index', path: 'index.html', size: 12, sha256: 'a'.repeat(64), mimeType: 'text/html' }] };
        const existing: any = { id: previewId, accountId: 'u1', sessionId: 's1', title: 'Draft', status, expiresAt, cleanupClaimedAt, manifest,
            assets: [{ ...manifest.assets[0], storageKey: `private/interactive-previews/u1/${previewId}/generation-1/index` }] };
        const createUpload = vi.fn();
        const database: any = { session: { findFirst: vi.fn(async () => ({ id: 's1' })) }, interactivePreview: { findUnique: vi.fn(async () => existing), create: vi.fn() } };
        const service = createPreviewService({ database, storage: { createUpload } as any, credentialStore: {} as any, clientFactory: vi.fn() as any, now: () => new Date('2026-09-04T01:00:00.000Z') });

        await expect(service.createDraft('u1', 's1', manifest)).rejects.toThrow('Preview not found');
        expect(createUpload).not.toHaveBeenCalled();
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

    it('rejects an expired draft at its publication claim even when cleanup has not run', async () => {
        const claimTime = new Date('2026-09-04T02:00:00.000Z');
        const bytes = Buffer.from('<h1>expired</h1>');
        const row: any = {
            id: '90909090-9090-4090-8090-909090909090', accountId: 'u1', sessionId: 's1', title: 'Expired', status: 'draft',
            url: null, publishedAt: null, expiresAt: claimTime, errorCode: null, publicationGeneration: 0, connectionGeneration: 0,
            stagingGeneration: 'generation-1', cleanupClaimedAt: null,
            assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), storageKey: 'private/interactive-previews/u1/90909090-9090-4090-8090-909090909090/generation-1/index', uploadedAt: claimTime }],
        };
        const updateMany = vi.fn(async ({ where, data }: any) => {
            if (where.status?.in?.includes(row.status) && where.expiresAt?.gt?.getTime?.() === claimTime.getTime()) {
                return { count: 0 };
            }
            Object.assign(row, data);
            return { count: 1 };
        });
        const credentialStore = { get: vi.fn(async () => ({ version: 1 as const, accessToken: 'secret', configurationId: 'icfg', projectId: 'prj_happy' })) };
        const createDeployment = vi.fn(async (input: any) => {
            await input.onCreated({ id: 'dpl_expired' });
            return { id: 'dpl_expired', url: 'https://expired.preview.local', readyState: 'READY' };
        });
        const service = createPreviewService({
            database: { interactivePreview: { findFirst: vi.fn(async () => row), updateMany } } as any,
            storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: credentialStore as any,
            clientFactory: vi.fn(() => ({
                ensurePreviewProject: vi.fn(async () => ({ id: 'prj_happy' })),
                lookupDeploymentByMetadata: vi.fn(async () => ({ visibility: 'not_found' })), uploadFile: vi.fn(), createDeployment,
            })) as any,
            now: () => claimTime,
        });

        await expect(service.publish('u1', 's1', row.id)).rejects.toThrow('Preview has expired');

        expect(credentialStore.get).not.toHaveBeenCalled();
        expect(createDeployment).not.toHaveBeenCalled();
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

    it('preserves the old credential and deletion tombstone when old-scope cleanup fails during a scope-changing reconnect', async () => {
        const previous = { version: 1 as const, accessToken: 'old-secret', configurationId: 'icfg-old', teamId: 'team-old', projectId: 'prj_old' };
        const replacement = { version: 1 as const, accessToken: 'new-secret', configurationId: 'icfg-new', teamId: 'team-new' };
        const row: any = {
            id: '16161616-1616-4161-8161-161616161616', accountId: 'u1', status: 'ready', vercelDeploymentId: 'dpl_old',
            vercelTeamId: 'team-old', stagingGeneration: 'generation-1', cleanupClaimedAt: null, assets: [],
        };
        let stored: any = previous;
        const account: any = { vercelConnectionEpoch: 0, vercelConnectionState: 'active', vercelConnectionReplacementId: null };
        const apply = (data: any) => Object.entries(data).forEach(([key, value]: any) => {
            account[key] = value?.increment === undefined ? value : account[key] + value.increment;
        });
        const database: any = {
            $transaction: async (work: any) => work({
                account: { update: vi.fn(async ({ data }: any) => { apply(data); return { ...account }; }) },
                interactivePreview: { updateMany: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }) },
            }),
            account: {
                findUnique: vi.fn(async () => ({ ...account })),
                updateMany: vi.fn(async ({ data }: any) => { apply(data); return { count: 1 }; }),
            },
            interactivePreview: {
                findMany: vi.fn(async () => [row]),
                updateMany: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }),
            },
        };
        const deleteDeployment = vi.fn(async () => { throw new Error('provider unavailable'); });
        const credentialStore: any = {
            get: vi.fn(async () => stored),
            set: vi.fn(async (_accountId: string, credential: typeof previous) => { stored = credential; }),
            replaceIfCurrent: vi.fn(async () => true),
            replaceAtConnectionEpoch: vi.fn(async () => true),
        };
        const clientFactory = vi.fn((credential: { token: string; teamId?: string }) => ({ deleteDeployment, credential }));
        const service = createPreviewService({ database, storage: { deletePreview: vi.fn() } as any, credentialStore, clientFactory: clientFactory as any });

        await expect(service.reconnectVercel('u1', replacement)).rejects.toThrow('VERCEL_CONNECTION_REPLACEMENT_CLEANUP_PENDING');

        expect(deleteDeployment).toHaveBeenCalledWith('dpl_old');
        expect(clientFactory).toHaveBeenCalledWith({ token: 'old-secret', teamId: 'team-old' });
        expect(stored).toEqual(previous);
        expect(row).toMatchObject({ status: 'deleting', errorCode: 'VERCEL_CONNECTION_REPLACEMENT_CLEANUP_PENDING' });
        expect(credentialStore.replaceAtConnectionEpoch).not.toHaveBeenCalled();
    });

    it('keeps the later callback credential active when reconnect writes complete out of order', async () => {
        const previous = { version: 1 as const, accessToken: 'old-secret', configurationId: 'icfg-old', teamId: 'team-old', projectId: 'prj_old' };
        const firstReplacement = { version: 1 as const, accessToken: 'first-secret', configurationId: 'icfg-first', teamId: 'team-first' };
        const laterReplacement = { version: 1 as const, accessToken: 'later-secret', configurationId: 'icfg-later', teamId: 'team-later' };
        let stored: any = previous;
        let releaseFirstWrite!: () => void;
        const firstWriteBlocked = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
        let signalFirstWrite!: () => void;
        const firstWriteStarted = new Promise<void>((resolve) => { signalFirstWrite = resolve; });
        let writes = 0;
        const account: any = { id: 'u1', vercelConnectionEpoch: 0, vercelConnectionState: 'active', vercelConnectionReplacementId: null };
        const matches = (where: any) => (!where.vercelConnectionState || where.vercelConnectionState === account.vercelConnectionState)
            && (!where.vercelConnectionReplacementId || where.vercelConnectionReplacementId === account.vercelConnectionReplacementId);
        const apply = (data: any) => Object.entries(data).forEach(([key, value]: any) => {
            account[key] = value?.increment === undefined ? value : account[key] + value.increment;
        });
        const database: any = {
            $transaction: async (work: any) => work({
                account: { update: vi.fn(async ({ data }: any) => { apply(data); return { ...account }; }) },
                interactivePreview: { updateMany: vi.fn(async () => ({ count: 0 })) },
            }),
            account: {
                findUnique: vi.fn(async () => ({ ...account })),
                updateMany: vi.fn(async ({ where, data }: any) => {
                    if (!matches(where)) return { count: 0 };
                    apply(data); return { count: 1 };
                }),
            },
            interactivePreview: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
        };
        const set = vi.fn(async (_accountId: string, credential: typeof previous) => {
            writes++;
            if (writes === 1) {
                signalFirstWrite();
                await firstWriteBlocked;
            }
            stored = credential;
        });
        const replaceIfCurrent = vi.fn(async (_accountId: string, expected: typeof previous | null, credential: typeof previous) => {
            if (JSON.stringify(stored) !== JSON.stringify(expected)) return false;
            writes++;
            if (writes === 1) {
                signalFirstWrite();
                await firstWriteBlocked;
            }
            stored = credential;
            return true;
        });
        const replaceAtConnectionEpoch = vi.fn(async (_accountId: string, epoch: number, credential: typeof previous) => {
            if ((stored.connectionEpoch ?? 0) >= epoch) return false;
            const observed = stored;
            writes++;
            if (writes === 1) {
                signalFirstWrite();
                await firstWriteBlocked;
            }
            if (stored !== observed) return false;
            stored = { ...credential, connectionEpoch: epoch };
            return true;
        });
        const service = createPreviewService({
            database, storage: { deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn(async () => stored), set, replaceIfCurrent, replaceAtConnectionEpoch } as any,
            clientFactory: vi.fn() as any,
        });

        const first = service.reconnectVercel('u1', firstReplacement);
        await firstWriteStarted;
        const later = service.reconnectVercel('u1', laterReplacement);
        await expect(later).resolves.toBeUndefined();
        releaseFirstWrite();
        await expect(first).rejects.toThrow('VERCEL_CONNECTION_REPLACEMENT_SUPERSEDED');

        expect(stored).toMatchObject({ ...laterReplacement, connectionEpoch: 2 });
        expect(account).toMatchObject({ vercelConnectionState: 'active', vercelConnectionEpoch: 2, vercelConnectionReplacementId: null });
    });

    it('does not let a delayed disconnect erase a reconnect that begins after its epoch fence', async () => {
        const previous = { version: 1 as const, accessToken: 'old-secret', configurationId: 'icfg', teamId: 'team-1', projectId: 'prj', connectionEpoch: 0 };
        const replacement = { version: 1 as const, accessToken: 'new-secret', configurationId: 'icfg', teamId: 'team-1' };
        let stored: any = previous;
        let releaseDelete!: () => void;
        let signalDelete!: () => void;
        const deleteBlocked = new Promise<void>((resolve) => { releaseDelete = resolve; });
        const deleteStarted = new Promise<void>((resolve) => { signalDelete = resolve; });
        const account: any = { id: 'u1', vercelConnectionEpoch: 0, vercelConnectionState: 'active', vercelConnectionNonce: null, vercelConnectionReplacementId: null, vercelConnectionReplacementStartedAt: null };
        const apply = (data: any) => Object.entries(data).forEach(([key, value]: any) => { account[key] = value?.increment === undefined ? value : account[key] + value.increment; });
        const database: any = {
            $transaction: async (work: any) => work({
                account: { update: vi.fn(async ({ data }: any) => { apply(data); return { vercelConnectionEpoch: account.vercelConnectionEpoch }; }) },
                interactivePreview: { updateMany: vi.fn(async () => ({ count: 0 })) },
            }),
            account: { findUnique: vi.fn(async () => ({ ...account })), updateMany: vi.fn(async ({ where, data }: any) => {
                if (where.vercelConnectionState && where.vercelConnectionState !== account.vercelConnectionState) return { count: 0 };
                if (where.vercelConnectionNonce && where.vercelConnectionNonce !== account.vercelConnectionNonce) return { count: 0 };
                if (where.vercelConnectionReplacementId && where.vercelConnectionReplacementId !== account.vercelConnectionReplacementId) return { count: 0 };
                apply(data); return { count: 1 };
            }) },
            interactivePreview: { updateMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => []) },
        };
        const credentialStore: any = {
            get: vi.fn(async () => stored),
            replaceAtConnectionVersion: vi.fn(async (_accountId: string, epoch: number, nonce: string, credential: any) => { stored = { ...credential, connectionEpoch: epoch, connectionNonce: nonce }; return true; }),
            deleteAtOrBeforeConnectionEpoch: vi.fn(async (_accountId: string, epoch: number) => {
                signalDelete(); await deleteBlocked;
                if ((stored?.connectionEpoch ?? 0) <= epoch) stored = null;
                return true;
            }),
        };
        const service = createPreviewService({ database, storage: { deletePreview: vi.fn() } as any, credentialStore, clientFactory: vi.fn() as any });

        const disconnect = service.disconnectVercel('u1');
        await deleteStarted;
        await expect(service.reconnectVercel('u1', replacement)).resolves.toBeUndefined();
        releaseDelete();
        await expect(disconnect).resolves.toMatchObject({ warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' });

        expect(account).toMatchObject({ vercelConnectionState: 'active', vercelConnectionEpoch: 2 });
        expect(stored).toMatchObject({ accessToken: 'new-secret', connectionEpoch: 2 });
    });

    it('keeps same-scope drafts publishable at the replacement epoch and tombstones in-flight attempts', async () => {
        const previous = { version: 1 as const, accessToken: 'old-secret', configurationId: 'icfg', teamId: 'team-1', projectId: 'prj' };
        const replacement = { version: 1 as const, accessToken: 'new-secret', configurationId: 'icfg', teamId: 'team-1' };
        const draft: any = { id: 'draft', accountId: 'u1', status: 'draft', connectionGeneration: 0, publicationGeneration: 0, publicationAttemptId: null };
        const publishing: any = { id: 'publishing', accountId: 'u1', status: 'publishing', connectionGeneration: 0, publicationGeneration: 4, publicationAttemptId: 'attempt-1' };
        const rows = [draft, publishing];
        const account: any = { id: 'u1', vercelConnectionEpoch: 0, vercelConnectionState: 'active', vercelConnectionReplacementId: null };
        const apply = (target: any, data: any) => Object.entries(data).forEach(([key, value]: any) => { target[key] = value?.increment === undefined ? value : target[key] + value.increment; });
        const updateRows = vi.fn(async ({ where, data }: any) => {
            const matching = rows.filter((row) => row.accountId === where.accountId
                && (!where.status || (Array.isArray(where.status.in) ? where.status.in.includes(row.status) : row.status === where.status)));
            matching.forEach((row) => apply(row, data));
            return { count: matching.length };
        });
        const database: any = {
            $transaction: async (work: any) => work({
                account: { update: vi.fn(async ({ data }: any) => { apply(account, data); return { vercelConnectionEpoch: account.vercelConnectionEpoch }; }) },
                interactivePreview: { updateMany: updateRows },
            }),
            account: { findUnique: vi.fn(async () => ({ ...account })), updateMany: vi.fn(async ({ data }: any) => { apply(account, data); return { count: 1 }; }) },
            interactivePreview: { updateMany: updateRows, findMany: vi.fn(async () => []) },
        };
        const service = createPreviewService({ database, storage: { deletePreview: vi.fn() } as any, credentialStore: { get: vi.fn(async () => previous), replaceAtConnectionVersion: vi.fn(async () => true), replaceAtConnectionEpoch: vi.fn(async () => true) } as any, clientFactory: vi.fn() as any });

        await service.reconnectVercel('u1', replacement);

        expect(draft).toMatchObject({ status: 'draft', connectionGeneration: 1 });
        expect(publishing).toMatchObject({ status: 'deleting', connectionGeneration: 1, publicationGeneration: 5 });
    });

    it('does not claim a newly created draft while a reconnect credential-write barrier is open', async () => {
        const bytes = Buffer.from('<h1>blocked</h1>');
        const claimTime = new Date('2026-09-04T02:00:00.000Z');
        const row: any = {
            id: '17171717-1717-4171-8171-171717171717', accountId: 'u1', sessionId: 's1', title: 'Blocked', status: 'draft',
            url: null, publishedAt: null, expiresAt: new Date('2026-09-04T03:00:00.000Z'), errorCode: null,
            publicationGeneration: 0, connectionGeneration: 1, stagingGeneration: 'generation-1', cleanupClaimedAt: null,
            assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), storageKey: 'private/interactive-previews/u1/17171717-1717-4171-8171-171717171717/generation-1/index', uploadedAt: claimTime }],
        };
        const account: any = { vercelConnectionEpoch: 1, vercelConnectionState: 'replacing', vercelConnectionReplacementId: 'replacement-1' };
        let releaseCredentialWrite!: () => void;
        const credentialWriteBarrier = new Promise<void>((resolve) => { releaseCredentialWrite = resolve; });
        let barrierOpen!: () => void;
        const barrierObserved = new Promise<void>((resolve) => { barrierOpen = resolve; });
        const replacement = (async () => {
            barrierOpen();
            await credentialWriteBarrier;
            account.vercelConnectionState = 'active';
            account.vercelConnectionReplacementId = null;
        })();
        const credentialStore = { get: vi.fn(async () => ({ version: 1 as const, accessToken: 'secret', configurationId: 'icfg', projectId: 'prj' })) };
        const createDeployment = vi.fn(async (input: any) => {
            await input.onCreated({ id: 'dpl_blocked' });
            return { id: 'dpl_blocked', url: 'https://blocked.preview.local', readyState: 'READY' };
        });
        const service = createPreviewService({
            database: {
                account: { findUnique: vi.fn(async () => ({ ...account })) },
                interactivePreview: {
                    findFirst: vi.fn(async () => row),
                    updateMany: vi.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }),
                },
            } as any,
            storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: credentialStore as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj' })), lookupDeploymentByMetadata: vi.fn(async () => ({ visibility: 'not_found' })), uploadFile: vi.fn(), createDeployment })) as any,
            now: () => claimTime,
        });

        await barrierObserved;
        await expect(service.publish('u1', 's1', row.id)).rejects.toThrow('VERCEL_CONNECTION_REPLACEMENT_IN_PROGRESS');
        releaseCredentialWrite();
        await replacement;

        expect(credentialStore.get).not.toHaveBeenCalled();
        expect(createDeployment).not.toHaveBeenCalled();
    });

    it('fences a stale replacement with a newer disconnected epoch instead of admitting publication', async () => {
        const claimTime = new Date('2026-09-04T02:00:00.000Z');
        const bytes = Buffer.from('<h1>recovered</h1>');
        const row: any = {
            id: '18181818-1818-4181-8181-181818181818', accountId: 'u1', sessionId: 's1', title: 'Recovered', status: 'draft',
            url: null, publishedAt: null, expiresAt: new Date('2026-09-04T03:00:00.000Z'), errorCode: null,
            publicationGeneration: 0, connectionGeneration: 1, stagingGeneration: 'generation-1', cleanupClaimedAt: null,
            assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), storageKey: 'private/interactive-previews/u1/18181818-1818-4181-8181-181818181818/generation-1/index', uploadedAt: claimTime }],
        };
        const account: any = {
            vercelConnectionEpoch: 1, vercelConnectionState: 'finalizing', vercelConnectionNonce: 'abandoned-replacement', vercelConnectionReplacementId: 'abandoned-replacement',
            vercelConnectionReplacementStartedAt: new Date('2026-09-04T01:40:00.000Z'),
        };
        const updateMany = vi.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; });
        const createDeployment = vi.fn(async (input: any) => {
            await input.onCreated({ id: 'dpl_recovered' });
            return { id: 'dpl_recovered', url: 'https://recovered.preview.local', readyState: 'READY' };
        });
        const service = createPreviewService({
            database: {
                account: {
                    findUnique: vi.fn(async () => ({ ...account })),
                    updateMany: vi.fn(async ({ where, data }: any) => {
                        if (where.vercelConnectionReplacementId !== account.vercelConnectionReplacementId) return { count: 0 };
                        Object.entries(data).forEach(([key, value]: any) => { account[key] = value?.increment === undefined ? value : account[key] + value.increment; });
                        return { count: 1 };
                    }),
                },
                interactivePreview: { findFirst: vi.fn(async () => row), updateMany },
            } as any,
            storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn() } as any,
            credentialStore: { get: vi.fn(async () => ({ version: 1 as const, accessToken: 'old-secret', configurationId: 'cfg-old', projectId: 'prj' })) } as any,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj' })), lookupDeploymentByMetadata: vi.fn(async () => ({ visibility: 'not_found' })), uploadFile: vi.fn(), createDeployment })) as any,
            now: () => claimTime,
        });

        await expect(service.publish('u1', 's1', row.id)).rejects.toThrow('VERCEL_CONNECTION_REPLACEMENT_IN_PROGRESS');

        expect(account).toMatchObject({ vercelConnectionState: 'disconnected', vercelConnectionReplacementId: null, vercelConnectionReplacementStartedAt: null, vercelConnectionEpoch: 2 });
        expect(createDeployment).not.toHaveBeenCalled();
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
        expect(configSha).toBe(createHash('sha1').update(configBytes).digest('hex'));
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
        const sha1 = createHash('sha1').update(bytes).digest('hex');
        expect(uploadFile).toHaveBeenCalledWith(sha1, bytes, 'text/html');
        expect(createDeployment.mock.calls[0][0]).toMatchObject({ files: expect.arrayContaining([{ file: 'index.html', sha: sha1, size: bytes.length }]) });
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

    it('fences and cleans a delayed publisher during a same-scope reconnect', async () => {
        const bytes = Buffer.from('<h1>same scope</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: 'fefefefe-fefe-4efe-8efe-fefefefefefe', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date('2026-09-05T00:00:00Z'), errorCode: null, publicationAttemptId: null, publicationGeneration: 0, connectionGeneration: 0, vercelDeploymentId: null, cleanupClaimedAt: null,
            assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/fefefefe-fefe-4efe-8efe-fefefefefefe/generation-1/index', uploadedAt: new Date() }] };
        const account: any = { id: 'u1', vercelConnectionEpoch: 0, vercelConnectionState: 'active', vercelConnectionNonce: null, vercelConnectionReplacementId: null, vercelConnectionReplacementStartedAt: null };
        const matches = (where: any): boolean => {
            if (where.id && where.id !== row.id || where.accountId && where.accountId !== row.accountId || where.sessionId && where.sessionId !== row.sessionId) return false;
            if (where.status?.in && !where.status.in.includes(row.status) || typeof where.status === 'string' && where.status !== row.status) return false;
            for (const key of ['publicationAttemptId', 'publicationGeneration', 'connectionGeneration', 'vercelDeploymentId', 'cleanupClaimedAt']) if (key in where && row[key] !== where[key]) return false;
            return !where.OR || where.OR.some((candidate: any) => matches({ ...candidate, id: row.id, accountId: row.accountId, sessionId: row.sessionId, status: row.status, publicationAttemptId: row.publicationAttemptId, publicationGeneration: row.publicationGeneration, connectionGeneration: row.connectionGeneration }));
        };
        const updateMany = vi.fn(async ({ where, data }: any) => {
            if (!matches(where)) return { count: 0 };
            Object.entries(data).forEach(([key, value]: any) => { row[key] = value?.increment === undefined ? value : row[key] + value.increment; });
            return { count: 1 };
        });
        const applyAccount = (data: any) => Object.entries(data).forEach(([key, value]: any) => { account[key] = value?.increment === undefined ? value : account[key] + value.increment; });
        let release!: () => void;
        const createDeployment = vi.fn(async (input: any) => {
            await new Promise<void>((resolve) => { release = resolve; });
            await input.onCreated({ id: 'dpl_same_scope' });
            return { id: 'dpl_same_scope', url: 'https://same-scope.preview.local', readyState: 'READY' };
        });
        const deleteDeployment = vi.fn(async () => {});
        const credentialStore: any = {
            get: vi.fn(async () => ({ version: 1, accessToken: 'same-scope-secret', configurationId: 'icfg', teamId: 'team-1', projectId: 'prj' })),
            replaceAtConnectionVersion: vi.fn(async () => true),
        };
        const database: any = {
            $transaction: async (work: any) => work({
                account: { update: vi.fn(async ({ data }: any) => { applyAccount(data); return { vercelConnectionEpoch: account.vercelConnectionEpoch }; }) },
                interactivePreview: { updateMany },
            }),
            account: { findUnique: vi.fn(async () => ({ ...account })), updateMany: vi.fn(async ({ where, data }: any) => {
                if (where.vercelConnectionState && where.vercelConnectionState !== account.vercelConnectionState) return { count: 0 };
                if (where.vercelConnectionNonce && where.vercelConnectionNonce !== account.vercelConnectionNonce) return { count: 0 };
                if (where.vercelConnectionReplacementId && where.vercelConnectionReplacementId !== account.vercelConnectionReplacementId) return { count: 0 };
                applyAccount(data); return { count: 1 };
            }) },
            interactivePreview: { findFirst: vi.fn(async () => row), findMany: vi.fn(async () => []), updateMany },
        };
        const service = createPreviewService({ database, storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn(async () => {}) } as any, credentialStore,
            clientFactory: vi.fn(() => ({ ensurePreviewProject: vi.fn(async () => ({ id: 'prj' })), lookupDeploymentByMetadata: vi.fn(async () => ({ visibility: 'not_found' })), uploadFile: vi.fn(), createDeployment, deleteDeployment })) as any });

        const publication = service.publish('u1', 's1', row.id);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await service.reconnectVercel('u1', { version: 1, accessToken: 'replacement-secret', configurationId: 'icfg', teamId: 'team-1' });
        release();

        await expect(publication).rejects.toThrow(/fenced.*connection change/i);
        expect(row).toMatchObject({ status: 'expired', connectionGeneration: 1, vercelDeploymentId: null, publicationAttemptId: null });
        expect(deleteDeployment).toHaveBeenCalledWith('dpl_same_scope');
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

    it('keeps an unknown-scope deployment tombstone and reports manual cleanup when a scoped disconnect lookup returns 404', async () => {
        const row: any = {
            id: 'deaddead-dead-4ead-8ead-deaddeaddead', accountId: 'u1', sessionId: 's1', status: 'ready', url: 'https://legacy.vercel.app', stagingGeneration: 'generation-1',
            vercelDeploymentId: 'dpl_legacy', vercelTeamId: null, vercelScopeKnown: false, publicationAttemptId: null, publicationCreateStartedAt: null, cleanupClaimedAt: null, assets: [],
        };
        const updateMany = vi.fn(async ({ where, data }: any) => {
            if (where.status?.in && !where.status.in.includes(row.status) || typeof where.status === 'string' && where.status !== row.status) return { count: 0 };
            if ('vercelDeploymentId' in where && where.vercelDeploymentId !== row.vercelDeploymentId) return { count: 0 };
            if ('cleanupClaimedAt' in where && where.cleanupClaimedAt !== row.cleanupClaimedAt) return { count: 0 };
            Object.entries(data).forEach(([key, value]: any) => { row[key] = value?.increment === undefined ? value : row[key] + value.increment; });
            return { count: 1 };
        });
        const credentialStore: any = { get: vi.fn(async () => ({ version: 1, accessToken: 'team-secret', configurationId: 'icfg', teamId: 'team-current' })), delete: vi.fn(async () => {}) };
        const resolveDeploymentScope = vi.fn(async () => ({ visibility: 'not_found' }));
        const service = createPreviewService({
            database: { interactivePreview: { updateMany, findMany: vi.fn(async () => [row]) } } as any,
            storage: { deletePreview: vi.fn(async () => {}) } as any,
            credentialStore,
            clientFactory: vi.fn(() => ({ resolveDeploymentScope, deleteDeployment: vi.fn(async () => {}) })) as any,
        });

        await expect(service.disconnectVercel('u1')).resolves.toEqual({ warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' });

        expect(resolveDeploymentScope).toHaveBeenCalledWith('dpl_legacy');
        expect(row).toMatchObject({ status: 'deleting', url: null, vercelDeploymentId: 'dpl_legacy', errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' });
        expect(credentialStore.delete).toHaveBeenCalledWith('u1');
    });

    it('keeps unknown-scope deployment tracking during stale-publication recovery when the current team returns 404', async () => {
        const time = new Date('2026-09-04T02:00:00.000Z');
        const row: any = {
            id: 'feedfeed-feed-4eed-8eed-feedfeedfeed', accountId: 'u1', status: 'deleting', title: 'Legacy', url: null, expiresAt: time,
            publicationAttemptId: 'attempt-legacy', publicationGeneration: 1, connectionGeneration: 0, publicationCreateStartedAt: new Date('2026-09-04T01:00:00.000Z'),
            publicationReconcileRetryCount: 0, vercelDeploymentId: 'dpl_legacy', vercelTeamId: null, vercelScopeKnown: false, cleanupClaimedAt: null, assets: [],
        };
        const updateMany = vi.fn(async ({ data }: any) => {
            Object.entries(data).forEach(([key, value]: any) => { row[key] = value?.increment === undefined ? value : row[key] + value.increment; });
            return { count: 1 };
        });
        const findMany = vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
        const resolveDeploymentScope = vi.fn(async () => ({ visibility: 'not_found' }));
        const service = createPreviewService({
            database: { interactivePreview: { findMany, updateMany } } as any,
            storage: { deletePreview: vi.fn(async () => {}) } as any,
            credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'team-secret', configurationId: 'icfg', teamId: 'team-current', projectId: 'prj' })) } as any,
            clientFactory: vi.fn(() => ({ resolveDeploymentScope })) as any,
            now: () => time,
        });

        await service.recoverStalePublications(time);

        expect(resolveDeploymentScope).toHaveBeenCalledWith('dpl_legacy');
        expect(row).toMatchObject({ status: 'deleting', vercelDeploymentId: 'dpl_legacy', publicationAttemptId: 'attempt-legacy', errorCode: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING', cleanupClaimedAt: null });
        expect(row.publicationReconcileNextAttemptAt).toEqual(new Date('2026-09-04T02:01:00.000Z'));
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

    it('denies publication when a credential does not match the active Account epoch and nonce', async () => {
        const bytes = Buffer.from('<h1>stale credential</h1>'); const sha256 = createHash('sha256').update(bytes).digest('hex');
        const row: any = { id: 'abababab-abab-4bab-8bab-abababababab', accountId: 'u1', sessionId: 's1', stagingGeneration: 'generation-1', title: 'Draft', status: 'draft', url: null, publishedAt: null,
            expiresAt: new Date('2026-09-05T00:00:00Z'), errorCode: null, publicationAttemptId: null, publicationGeneration: 0, connectionGeneration: 5, vercelDeploymentId: null, cleanupClaimedAt: null,
            assets: [{ id: 'index', path: 'index.html', mimeType: 'text/html', size: bytes.length, sha256, storageKey: 'private/interactive-previews/u1/abababab-abab-4bab-8bab-abababababab/generation-1/index', uploadedAt: new Date() }] };
        const account = { vercelConnectionEpoch: 5, vercelConnectionState: 'active', vercelConnectionNonce: 'active-nonce', vercelConnectionReplacementId: null, vercelConnectionReplacementStartedAt: null };
        const staleCredential = { version: 1 as const, accessToken: 'stale-secret', configurationId: 'icfg', connectionEpoch: 4, connectionNonce: 'stale-nonce' };
        const updateMany = vi.fn(async ({ data }: any) => {
            Object.entries(data).forEach(([key, value]: any) => { row[key] = value?.increment === undefined ? value : row[key] + value.increment; });
            return { count: 1 };
        });
        const clientFactory = vi.fn();
        const service = createPreviewService({
            database: { account: { findUnique: vi.fn(async () => ({ ...account })) }, interactivePreview: { findFirst: vi.fn(async () => row), updateMany } } as any,
            storage: { read: vi.fn(async () => bytes), deletePreview: vi.fn(async () => {}) } as any,
            credentialStore: { get: vi.fn(async () => staleCredential) } as any,
            clientFactory: clientFactory as any,
        });

        await expect(service.publish('u1', 's1', row.id)).rejects.toThrow('VERCEL_NOT_CONNECTED');

        expect(clientFactory).not.toHaveBeenCalled();
        // A mismatched active record is unauthorized, but its exact snapshot
        // is not discarded by a status/publish read.
    });

    it('treats a predecessor retained after disconnect as inactive without deleting it', async () => {
        const staleCredential = { version: 1 as const, accessToken: 'stale-secret', configurationId: 'icfg', connectionEpoch: 4, connectionNonce: 'stale-nonce' };
        const service = createPreviewService({
            database: { account: { findUnique: vi.fn(async () => ({
                vercelConnectionEpoch: 5, vercelConnectionState: 'disconnected', vercelConnectionNonce: 'disconnect-nonce', vercelConnectionReplacementId: null, vercelConnectionReplacementStartedAt: null,
            })) } } as any,
            storage: {} as any,
            credentialStore: { get: vi.fn(async () => staleCredential) } as any,
            clientFactory: vi.fn() as any,
        });

        await expect(service.getActiveVercelCredential('u1')).resolves.toBeNull();

    });

});
