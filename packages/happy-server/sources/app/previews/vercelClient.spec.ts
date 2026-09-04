import { describe, expect, it, vi } from 'vitest';
import { createVercelClient } from './vercelClient';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createVercelClient', () => {
    it('creates a configuration-derived project after refusing a colliding generic project name', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'project_name_in_use' } }, 409))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_happy', name: 'happy-previews-a3863a34b6bb' }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect((client as any).ensurePreviewProject({ configurationId: 'icfg_123' })).resolves.toEqual({ id: 'prj_happy' });

        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            'https://api.vercel.com/v11/projects',
            'https://api.vercel.com/v11/projects',
        ]);
        expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
            name: 'happy-previews', framework: null, publicSource: false,
        });
        expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({
            name: 'happy-previews-a3863a34b6bb', framework: null, publicSource: false,
        });
    });

    it('validates and reuses the encrypted credential project identifier', async () => {
        const fetchImpl = vi.fn(async (_url: string, _init?: unknown) => jsonResponse({ id: 'prj_saved', name: 'happy-previews' }));
        const client = createVercelClient({ token: 'secret', teamId: 'team_1', fetchImpl });

        await expect((client as any).ensurePreviewProject({ configurationId: 'icfg_123', projectId: 'prj_saved' })).resolves.toEqual({ id: 'prj_saved' });

        expect(fetchImpl.mock.calls).toHaveLength(1);
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.vercel.com/v9/projects/prj_saved?teamId=team_1');
    });

    it('uploads exact file bytes to the fixed Vercel origin with a digest', async () => {
        const fetchImpl = vi.fn(async (_url: string, _init?: any) => jsonResponse({}));
        const client = createVercelClient({ token: 'secret', teamId: 'team_1', fetchImpl });
        const bytes = new Uint8Array([1, 2, 3]);

        await client.uploadFile('a'.repeat(64), bytes, 'text/html');

        expect(fetchImpl).toHaveBeenCalledOnce();
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.vercel.com/v2/files?teamId=team_1');
        expect(init).toMatchObject({ method: 'POST', body: bytes });
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
        expect(new Headers(init?.headers).get('x-vercel-digest')).toBe('a'.repeat(64));
    });

    it('creates a non-production static deployment from SHA references', async () => {
        const fetchImpl = vi.fn(async (_url: string, _init?: any) => jsonResponse({
            id: 'dpl_1', url: 'happy-preview.vercel.app', readyState: 'READY', target: null,
        }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        const result = await client.createDeployment({
            name: 'happy-previews',
            projectId: 'prj_1',
            meta: { happyPreviewId: 'preview-1' },
            files: [{ file: 'index.html', sha: 'b'.repeat(64), size: 42 }],
        });

        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://api.vercel.com/v13/deployments');
        expect(JSON.parse(String(init?.body))).toMatchObject({
            name: 'happy-previews',
            project: 'prj_1',
            target: null,
            files: [{ file: 'index.html', sha: 'b'.repeat(64), size: 42 }],
            projectSettings: { framework: null },
        });
        expect(result).toEqual({ id: 'dpl_1', url: 'https://happy-preview.vercel.app', readyState: 'READY' });
    });

    it('polls a preview deployment until Vercel confirms it is ready', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_wait', url: 'happy-preview.vercel.app', readyState: 'BUILDING', target: null }))
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_wait', url: 'happy-preview.vercel.app', readyState: 'READY', target: null }));
        const sleep = vi.fn(async () => {});
        const client = createVercelClient({ token: 'secret', fetchImpl, sleep, pollIntervalMs: 0 });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: 'd'.repeat(64), size: 1 }], meta: {} }))
            .resolves.toEqual({ id: 'dpl_wait', url: 'https://happy-preview.vercel.app', readyState: 'READY' });

        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            'https://api.vercel.com/v13/deployments',
            'https://api.vercel.com/v13/deployments/dpl_wait',
        ]);
        expect(sleep).toHaveBeenCalledOnce();
    });

    it('rejects a terminal Vercel deployment failure instead of returning its URL', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_failed', url: 'happy-preview.vercel.app', readyState: 'QUEUED', target: null }))
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_failed', url: 'happy-preview.vercel.app', readyState: 'ERROR', target: null }));
        const client = createVercelClient({ token: 'secret', fetchImpl, sleep: async () => {}, pollIntervalMs: 0 });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: 'e'.repeat(64), size: 1 }], meta: {} }))
            .rejects.toThrow(/terminal/i);
    });

    it('times out an unready Vercel deployment instead of returning an unverified URL', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ id: 'dpl_slow', url: 'happy-preview.vercel.app', readyState: 'BUILDING', target: null }));
        const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(101);
        const client = createVercelClient({ token: 'secret', fetchImpl, now, sleep: async () => {}, pollIntervalMs: 0, deploymentTimeoutMs: 100 });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: 'f'.repeat(64), size: 1 }], meta: {} }))
            .rejects.toThrow(/timed out/i);
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('rejects an unexpected production deployment response', async () => {
        const client = createVercelClient({
            token: 'secret',
            fetchImpl: vi.fn(async (_url: string, _init?: any) => jsonResponse({ id: 'dpl_2', url: 'prod.vercel.app', target: 'production' })),
        });
        await expect(client.createDeployment({
            name: 'happy-previews', files: [{ file: 'index.html', sha: 'c'.repeat(64), size: 1 }], meta: {},
        })).rejects.toThrow(/production/i);
    });

    it('deletes only the recorded deployment id and reports bounded provider errors', async () => {
        const fetchImpl = vi.fn(async (_url: string, _init?: any) => jsonResponse({ error: { code: 'rate_limited', message: 'secret provider detail' } }, 429));
        const client = createVercelClient({ token: 'secret', fetchImpl });
        await expect(client.deleteDeployment('dpl_safe-1')).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
        expect(fetchImpl.mock.calls[0][0]).toBe('https://api.vercel.com/v13/deployments/dpl_safe-1');
    });

    it('rejects unsafe provider identifiers before building a URL', async () => {
        const fetchImpl = vi.fn(async (_url: string, _init?: any) => jsonResponse({}));
        const client = createVercelClient({ token: 'secret', fetchImpl });
        await expect(client.deleteDeployment('../projects')).rejects.toThrow(/identifier/i);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
