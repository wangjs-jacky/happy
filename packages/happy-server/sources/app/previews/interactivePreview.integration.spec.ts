import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createVercelClient } from './vercelClient';
import { createPreviewStorage } from './previewStorage';

// MinIO is not provisioned by the unit-test runner. This is the closest genuine
// boundary: Vercel is a real local HTTP server, while the S3-compatible contract
// is exercised through the same MinIO client surface used in production.
describe('interactive preview integration boundaries', () => {
    const servers: ReturnType<typeof createServer>[] = [];
    afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

    it('streams sequential files to a local Vercel HTTP provider, waits for Preview readiness, and removes staged objects', async () => {
        const requests: Array<{ url: string; body: Buffer }> = [];
        let polls = 0;
        const server = createServer(async (request, response) => {
            const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const body = Buffer.concat(chunks); requests.push({ url: request.url!, body });
            const json = (value: unknown) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); };
            if (request.url === '/v2/files') return json({});
            if (request.url === '/v13/deployments' && request.method === 'POST') return json({ id: 'dpl_local', url: 'preview.local', readyState: 'BUILDING', target: null, aliasAssigned: false });
            if (request.url === '/v13/deployments/dpl_local') return json({ id: 'dpl_local', url: 'preview.local', readyState: ++polls === 1 ? 'READY' : 'READY', target: null, aliasAssigned: false });
            if (request.url === '/v13/deployments/dpl_local' && request.method === 'DELETE') return json({});
            response.statusCode = 404; return json({ error: { code: 'not_found' } });
        });
        servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const address = server.address() as { port: number };
        const client = createVercelClient({ token: 'test-token', apiOrigin: `http://127.0.0.1:${address.port}`, sleep: async () => {}, pollIntervalMs: 0 });
        const objects = new Map<string, Buffer>();
        const stream = () => { const listeners: Record<string, Function> = {}; return { on(name: string, fn: Function) { listeners[name] = fn; if (name === 'end') queueMicrotask(() => fn()); return this; }, listeners }; };
        const storage = createPreviewStorage({ client: {
            newPostPolicy: () => ({ setBucket() {}, setKey() {}, setExpires() {}, setContentLengthRange() {} }), presignedPostPolicy: async () => ({ postURL: 'http://s3.local', formData: {} }),
            statObject: async (_bucket: string, key: string) => ({ size: objects.get(key)!.length }), getObject: async (_bucket: string, key: string) => Readable.from([objects.get(key)!]),
            listObjects: (_bucket: string, prefix: string) => { const result = stream(); queueMicrotask(() => { for (const key of objects.keys()) if (key.startsWith(prefix)) result.listeners.data?.({ name: key }); result.listeners.end?.(); }); return result; },
            removeObjects: async (_bucket: string, keys: string[]) => { keys.forEach((key) => objects.delete(key)); },
        } as any, bucket: 'preview' });
        const previewId = '11111111-1111-4111-8111-111111111111';
        objects.set(storage.storageKey(previewId, 'index'), Buffer.from('<h1>ok</h1>'));
        objects.set(storage.storageKey(previewId, 'css'), Buffer.from('body{}'));
        await storage.assertUploaded(previewId, 'index', 11);
        await client.uploadFile('a'.repeat(64), await storage.read(previewId, 'index', 11), 'text/html');
        await client.uploadFile('b'.repeat(64), await storage.read(previewId, 'css', 6), 'text/css');
        await expect(client.createDeployment({ name: 'happy-previews', files: [], meta: { happyPreviewId: previewId } })).resolves.toMatchObject({ id: 'dpl_local', url: 'https://preview.local' });
        await storage.deletePreview(previewId);
        expect(objects.size).toBe(0);
        expect(requests.filter((request) => request.url === '/v2/files')).toHaveLength(2);
        expect(requests.map((request) => request.url)).toEqual(['/v2/files', '/v2/files', '/v13/deployments', '/v13/deployments/dpl_local']);
    });
});
