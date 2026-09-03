import { describe, expect, it, vi } from 'vitest';
import { createVercelClient } from './vercelClient';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createVercelClient', () => {
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
