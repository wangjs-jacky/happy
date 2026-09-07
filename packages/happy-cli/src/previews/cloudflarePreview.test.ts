import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewWorkspaceRegistry } from './previewWorkspace';
import { createPreviewAssetServer, startCloudflarePreview } from './cloudflarePreview';

describe('Cloudflare preview asset boundary', () => {
    const cleanup: Array<() => void | Promise<void>> = [];
    afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

    async function workspace() {
        const root = await mkdtemp(join(tmpdir(), 'happy-cf-test-'));
        cleanup.push(() => rm(root, { recursive: true, force: true }));
        const registry = new PreviewWorkspaceRegistry(root);
        const draft = await registry.create('session', 'Cloudflare fixture');
        await writeFile(join(draft.path, 'index.html'), '<h1>Public preview only</h1>');
        return { registry, draft, resolved: await registry.resolveForPublish('session', draft.previewId) };
    }

    it('serves immutable assets after workspace removal and rejects undeclared paths and writes', async () => {
        const { registry, draft, resolved } = await workspace();
        const server = await createPreviewAssetServer(resolved);
        cleanup.push(() => { server.closeAllConnections(); server.close(); });
        await registry.remove('session', draft.previewId);
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const response = await fetch(`${url}/?preview=1`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('<h1>Public preview only</h1>');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        for (const path of ['/.env', '/%2e%2e%2faccess.key', '/unknown', '/%ZZ']) {
            expect((await fetch(url + path)).status).toBeGreaterThanOrEqual(400);
        }
        expect((await fetch(url, { method: 'POST', body: 'overwrite' })).status).toBe(405);
        expect(await (await fetch(url, { method: 'HEAD' })).text()).toBe('');
    });

    it('rejects assets changed after validation before opening a listener', async () => {
        const { draft, resolved } = await workspace();
        await writeFile(join(draft.path, 'index.html'), 'changed');
        await expect(createPreviewAssetServer(resolved)).rejects.toThrow('changed after validation');
    });

    it('rejects a stopped session without starting a tunnel', async () => {
        const { resolved } = await workspace();
        const controller = new AbortController();
        controller.abort();
        await expect(startCloudflarePreview(resolved, () => {}, controller.signal)).rejects.toThrow();
    });
});
