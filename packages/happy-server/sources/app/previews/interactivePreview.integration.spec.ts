import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Fastify } from '../api/types';
import { interactivePreviewRoutes } from '../api/routes/interactivePreviewRoutes';
import { createPreviewStorage } from './previewStorage';
import { createVercelClient } from './vercelClient';
import { createPreviewService } from './previewService';
import { createPreviewCleanup } from './previewCleanup';

const previewId = '11111111-1111-4111-8111-111111111111';
const bytes = Buffer.from('<h1>preview</h1>');
const manifest = { version: 1 as const, previewId, title: 'Preview', assets: [{ id: 'index', path: 'index.html', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'text/html' }] };

function store() {
    const rows = new Map<string, any>(); const sessions = new Set(['s-a']);
    const matches = (row: any, where: any) => !where || Object.entries(where).every(([key, value]: any) => key === 'OR' || key === 'AND' ? true : key === 'status' && value?.in ? value.in.includes(row.status) : row[key] === value);
    const apply = (row: any, data: any) => Object.entries(data).forEach(([key, value]: any) => { row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] || 0) + value.increment : value; });
    return { rows, database: { session: { findFirst: vi.fn(async ({ where }: any) => where.accountId === 'a' && sessions.has(where.id) ? { id: where.id } : null) }, interactivePreview: {
        create: vi.fn(async ({ data }: any) => { const row = { ...data, status: 'draft', url: null, publishedAt: null, errorCode: null, cleanupClaimedAt: null, cleanupRetryCount: 0, cleanupNextAttemptAt: null, createdAt: new Date(), updatedAt: new Date(), assets: data.assets.create.map((asset: any) => ({ ...asset, uploadedAt: null })) }; rows.set(row.id, row); return row; }),
        findFirst: vi.fn(async ({ where }: any) => [...rows.values()].find((row) => matches(row, where)) || null),
        findMany: vi.fn(async ({ where }: any) => [...rows.values()].filter((row) => !where?.accountId || row.accountId === where.accountId)),
        updateMany: vi.fn(async ({ where, data }: any) => { const row = [...rows.values()].find((candidate) => matches(candidate, where)); if (!row) return { count: 0 }; apply(row, data); row.updatedAt = new Date(); return { count: 1 }; }),
        update: vi.fn(async ({ where, data }: any) => { const row = rows.get(where.id); if (!row) throw new Error('missing'); apply(row, data); return row; }),
    }, interactivePreviewAsset: { update: vi.fn(async ({ where, data }: any) => { const row = rows.get(where.previewId_id.previewId); const asset = row.assets.find((item: any) => item.id === where.previewId_id.id); apply(asset, data); return asset; }) } } } as any;
}

function s3() {
    const objects = new Map<string, Buffer>();
    const storage = createPreviewStorage({ client: {
        newPostPolicy: () => ({ setBucket() {}, setKey() {}, setExpires() {}, setContentLengthRange() {} }), presignedPostPolicy: async () => ({ postURL: 'http://in-process-s3/upload', formData: {} }),
        statObject: async (_bucket: string, key: string) => ({ size: objects.get(key)!.length }), getObject: async (_bucket: string, key: string) => Readable.from([objects.get(key)!]),
        listObjects: (_bucket: string, prefix: string) => { const listeners: Record<string, Function> = {}; const stream: any = { on(name: string, fn: Function) { listeners[name] = fn; if (name === 'end') queueMicrotask(() => { for (const key of objects.keys()) if (key.startsWith(prefix)) listeners.data?.({ name: key }); listeners.end(); }); return stream; } }; return stream; },
        removeObjects: async (_bucket: string, keys: string[]) => keys.forEach((key) => objects.delete(key)),
    } as any, bucket: 'preview' });
    return { objects, storage };
}

describe('interactive preview integration', () => {
    const servers: ReturnType<typeof createServer>[] = [];
    afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

    it('runs authenticated draft/upload/complete/publish through routes, emits a typed ready event, and removes staging', async () => {
        const uploads: Buffer[] = []; let deletes = 0;
        const server = createServer(async (request, response) => { const body: Buffer[] = []; for await (const chunk of request) body.push(Buffer.from(chunk)); const send = (value: unknown) => response.end(JSON.stringify(value));
            if (request.url?.startsWith('/v9/projects/')) return send({ id: 'prj', name: 'happy-previews', installCommand: 'echo happy-preview-owner:e67d23e7820c49a8' });
            if (request.url === '/v2/files') { uploads.push(Buffer.concat(body)); return send({}); }
            if (request.url === '/v13/deployments' && request.method === 'POST') return send({ id: 'dpl', url: 'preview.local', readyState: 'READY', target: null, aliasAssigned: false });
            if (request.url === '/v13/deployments/dpl' && request.method === 'DELETE') { deletes++; return send({}); }
            response.statusCode = 404; return send({ error: { code: 'not_found' } }); });
        servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = (server.address() as any).port;
        const { database, rows } = store(); const { storage, objects } = s3();
        const clientFactory = vi.fn((_: any) => createVercelClient({ token: 'token', apiOrigin: `http://127.0.0.1:${port}`, sleep: async () => {}, pollIntervalMs: 0 }));
        const service = createPreviewService({ database, storage: storage as any, credentialStore: { get: vi.fn(async () => ({ version: 1, accessToken: 'token', configurationId: 'cfg', projectId: 'prj' })), setProjectIdIfCurrent: vi.fn(), delete: vi.fn() } as any, clientFactory: clientFactory as any });
        const app = fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler); const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
        typed.decorate('authenticate', async (request: any, reply: any) => { if (!request.headers['x-user-id']) return reply.code(401).send({ error: 'Unauthorized' }); request.userId = request.headers['x-user-id']; }); interactivePreviewRoutes(typed, service); await typed.ready();
        const draft = await typed.inject({ method: 'POST', url: '/v1/sessions/s-a/interactive-previews/drafts', headers: { 'x-user-id': 'a' }, payload: manifest }); expect(draft.statusCode).toBe(200);
        objects.set(storage.storageKey(previewId, 'index'), bytes); // direct upload at the same private S3 client boundary
        expect((await typed.inject({ method: 'POST', url: `/v1/interactive-previews/${previewId}/assets/index/complete`, headers: { 'x-user-id': 'a' } })).statusCode).toBe(200);
        const published = await typed.inject({ method: 'POST', url: `/v1/interactive-previews/${previewId}/publish`, headers: { 'x-user-id': 'a' } }); expect(published.statusCode, published.body).toBe(200); expect(published.json().preview).toMatchObject({ version: 1, id: previewId, state: 'ready', url: 'https://preview.local' }); expect(objects.size).toBe(0); expect(uploads).toHaveLength(2);
        expect((await typed.inject({ method: 'GET', url: '/v1/interactive-previews', headers: { 'x-user-id': 'b' } })).json().previews).toEqual([]);
        expect((await typed.inject({ method: 'POST', url: `/v1/interactive-previews/${previewId}/publish`, headers: { 'x-user-id': 'b' } })).statusCode).not.toBe(200);
        rows.get(previewId).expiresAt = new Date(0); const cleanup = createPreviewCleanup({ database, storage: storage as any, credentialStore: { get: vi.fn(async () => ({ accessToken: 'token' })) } as any, clientFactory: clientFactory as any }); await cleanup.cleanupExpired(new Date()); expect(rows.get(previewId).status).toBe('expired'); expect(deletes).toBe(1); await typed.close();
    });

    it('holds a global two-publication cap, keeps per-preview uploads sequential, and returns an in-flight duplicate', async () => {
        const { database, rows } = store(); const { storage, objects } = s3(); const releases: Array<() => void> = []; let active = 0; let maximum = 0; let deployments = 0;
        const make = (id: string) => { const body = Buffer.from(id); const sha = createHash('sha256').update(body).digest('hex'); const row: any = { id, accountId: 'a', title: id, status: 'draft', url: null, publishedAt: null, expiresAt: new Date(Date.now() + 60_000), errorCode: null, cleanupClaimedAt: null, assets: [{ id: 'one', path: 'index.html', mimeType: 'text/html', size: body.length, sha256: sha, uploadedAt: new Date() }, { id: 'two', path: 'app.js', mimeType: 'text/javascript', size: body.length, sha256: sha, uploadedAt: new Date() }] }; rows.set(id, row); objects.set(storage.storageKey(id, 'one'), body); objects.set(storage.storageKey(id, 'two'), body); return row; };
        const ids = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']; ids.forEach(make);
        const uploads = new Map<string, number>(); const client = { ensurePreviewProject: async () => ({ id: 'prj' }), uploadFile: async () => {}, createDeployment: async (input: any) => { deployments++; active++; maximum = Math.max(maximum, active); const id = input.meta.happyPreviewId; await new Promise<void>((resolve) => releases.push(resolve)); active--; await input.onCreated({ id: `dpl_${id}` }); return { id: `dpl_${id}`, url: `${id}.local`, readyState: 'READY' }; } };
        const service = createPreviewService({ database, storage: storage as any, credentialStore: { get: vi.fn(async () => ({ accessToken: 'token', configurationId: 'cfg' })), setProjectIdIfCurrent: vi.fn(async () => true) } as any, clientFactory: vi.fn(() => client) as any });
        const first = service.publish('a', ids[0]); const second = service.publish('a', ids[1]); const third = service.publish('a', ids[2]); await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(service.publish('a', ids[0])).resolves.toMatchObject({ state: 'publishing' }); expect(deployments).toBe(2); expect(maximum).toBe(2);
        releases.shift()!(); releases.shift()!(); await new Promise((resolve) => setTimeout(resolve, 0)); expect(deployments).toBe(3); releases.shift()!(); await Promise.all([first, second, third]); expect(maximum).toBe(2);
    });

    it('replays persisted stale/deleting tombstones without creating a deployment and honors retry deadlines', async () => {
        const { database, rows } = store(); const { storage } = s3(); const stale: any = { id: '55555555-5555-4555-8555-555555555555', accountId: 'a', status: 'publishing', vercelDeploymentId: 'dpl_old', expiresAt: new Date(0), updatedAt: new Date(0), cleanupClaimedAt: null, cleanupRetryCount: 0, cleanupNextAttemptAt: null }; rows.set(stale.id, stale);
        const deleted: string[] = []; const cleanup = createPreviewCleanup({ database, storage: storage as any, credentialStore: { get: vi.fn(async () => ({ accessToken: 'token' })) } as any, clientFactory: vi.fn(() => ({ deleteDeployment: async (id: string) => deleted.push(id) })) as any });
        await cleanup.cleanupExpired(new Date('2026-09-04T01:00:00Z')); expect(deleted).toEqual(['dpl_old']); expect(stale.status).toBe('expired');
        const deferred: any = { id: '66666666-6666-4666-8666-666666666666', accountId: 'a', status: 'deleting', vercelDeploymentId: 'dpl_later', expiresAt: new Date(0), updatedAt: new Date(0), cleanupClaimedAt: null, cleanupRetryCount: 1, cleanupNextAttemptAt: new Date('2026-09-04T02:00:00Z') }; rows.set(deferred.id, deferred);
        // The production query carries the durable deadline; this fake DB exposes it as the cross-replica boundary assertion.
        await cleanup.cleanupExpired(new Date('2026-09-04T01:30:00Z')); expect(database.interactivePreview.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ cleanupNextAttemptAt: { lte: new Date('2026-09-04T01:30:00Z') } })]) })]) }) }));
    });
});
