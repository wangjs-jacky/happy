import { describe, expect, it, vi } from 'vitest';
import { createVercelClient } from './vercelClient';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createVercelClient', () => {
    it('creates a configuration-derived project after refusing a colliding generic project name', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'project_name_in_use' } }, 409))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_unrelated', name: 'happy-previews', installCommand: 'echo somebody-else' }))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_happy', name: 'happy-previews-a3863a34b6bb', installCommand: 'echo happy-preview-owner:a3863a34b6bb238e' }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect((client as any).ensurePreviewProject({ configurationId: 'icfg_123' })).resolves.toEqual({ id: 'prj_happy' });

        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            'https://api.vercel.com/v11/projects',
            'https://api.vercel.com/v9/projects/happy-previews',
            'https://api.vercel.com/v11/projects',
        ]);
        expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
            name: 'happy-previews', framework: null, publicSource: false, installCommand: 'echo happy-preview-owner:a3863a34b6bb238e',
        });
        expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body))).toEqual({
            name: 'happy-previews-a3863a34b6bb', framework: null, publicSource: false, installCommand: 'echo happy-preview-owner:a3863a34b6bb238e',
        });
    });

    it('adopts a concurrently created project only after its provider ownership marker matches', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'project_name_in_use' } }, 409))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_concurrent', name: 'happy-previews', installCommand: 'echo happy-preview-owner:a3863a34b6bb238e' }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect(client.ensurePreviewProject({ configurationId: 'icfg_123' })).resolves.toEqual({ id: 'prj_concurrent' });
        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            'https://api.vercel.com/v11/projects',
            'https://api.vercel.com/v9/projects/happy-previews',
        ]);
    });

    it('adopts an existing configuration-derived project after a create-then-store retry', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'project_name_in_use' } }, 409))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_unrelated', name: 'happy-previews', installCommand: 'echo somebody-else' }))
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'project_name_in_use' } }, 409))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_retry', name: 'happy-previews-a3863a34b6bb', installCommand: 'echo happy-preview-owner:a3863a34b6bb238e' }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect(client.ensurePreviewProject({ configurationId: 'icfg_123' })).resolves.toEqual({ id: 'prj_retry' });
        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            'https://api.vercel.com/v11/projects',
            'https://api.vercel.com/v9/projects/happy-previews',
            'https://api.vercel.com/v11/projects',
            'https://api.vercel.com/v9/projects/happy-previews-a3863a34b6bb',
        ]);
    });

    it('skips unrelated collisions and deterministically creates the next safe project name', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'project_name_in_use' } }, 409))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_unrelated', name: 'happy-previews', installCommand: 'echo somebody-else' }))
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'project_name_in_use' } }, 409))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_unrelated_derived', name: 'happy-previews-a3863a34b6bb', installCommand: 'echo somebody-else' }))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_safe', name: 'happy-previews-a3863a34b6bb-1', installCommand: 'echo happy-preview-owner:a3863a34b6bb238e' }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect(client.ensurePreviewProject({ configurationId: 'icfg_123' })).resolves.toEqual({ id: 'prj_safe' });
        expect(JSON.parse(String(fetchImpl.mock.calls[4][1]?.body))).toEqual({
            name: 'happy-previews-a3863a34b6bb-1', framework: null, publicSource: false, installCommand: 'echo happy-preview-owner:a3863a34b6bb238e',
        });
    });

    it.each([undefined, null])('treats an unrelated %s project marker as a collision', async (installCommand) => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'project_name_in_use' } }, 409))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_unrelated', name: 'happy-previews', ...(installCommand === undefined ? {} : { installCommand }) }))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_safe', name: 'happy-previews-a3863a34b6bb', installCommand: 'echo happy-preview-owner:a3863a34b6bb238e' }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect(client.ensurePreviewProject({ configurationId: 'icfg_123' })).resolves.toEqual({ id: 'prj_safe' });
    });

    it('reads a newly created project before claiming ownership when its create response omits the marker', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_created', name: 'happy-previews' }))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_created', name: 'happy-previews', installCommand: 'echo happy-preview-owner:a3863a34b6bb238e' }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect(client.ensurePreviewProject({ configurationId: 'icfg_123' })).resolves.toEqual({ id: 'prj_created' });
        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            'https://api.vercel.com/v11/projects',
            'https://api.vercel.com/v9/projects/prj_created',
        ]);
    });

    it('recovers from a deleted saved project by provisioning a replacement', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'not_found' } }, 404))
            .mockResolvedValueOnce(jsonResponse({ id: 'prj_replacement', name: 'happy-previews', installCommand: 'echo happy-preview-owner:a3863a34b6bb238e' }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect(client.ensurePreviewProject({ configurationId: 'icfg_123', projectId: 'prj_deleted' })).resolves.toEqual({ id: 'prj_replacement' });
    });

    it('validates and reuses the encrypted credential project identifier', async () => {
        const fetchImpl = vi.fn(async (_url: string, _init?: unknown) => jsonResponse({ id: 'prj_saved', name: 'happy-previews', installCommand: 'echo happy-preview-owner:a3863a34b6bb238e' }));
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
            id: 'dpl_1', url: 'happy-preview.vercel.app', readyState: 'READY', target: null, aliasAssigned: false,
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

    it('reconciles a deployment by its Happy preview and publication-attempt metadata in the scoped project', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ deployments: [{
            id: 'dpl_recovered', url: 'recovered.vercel.app', readyState: 'READY', target: null, aliasAssigned: false,
            meta: { happyPreviewId: 'preview-1', happyPublicationAttemptId: 'attempt-1' },
        }] }));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect((client as any).lookupDeploymentByMetadata({
            projectId: 'prj_1', happyPreviewId: 'preview-1', publicationAttemptId: 'attempt-1',
        })).resolves.toEqual({ visibility: 'ready', deployment: { id: 'dpl_recovered', url: 'https://recovered.vercel.app', readyState: 'READY' } });

        expect((fetchImpl as any).mock.calls[0][0]).toBe('https://api.vercel.com/v6/deployments?projectId=prj_1&meta-happyPreviewId=preview-1&meta-happyPublicationAttemptId=attempt-1');
    });

    it('reports delayed, terminal, and absent metadata lookups without polling before durable tracking', async () => {
        const deployment = (id: string, readyState: string) => ({
            id, url: `${id}.vercel.app`, readyState, target: null, aliasAssigned: false,
            meta: { happyPreviewId: 'preview-1', happyPublicationAttemptId: 'attempt-1' },
        });
        const responses = [
            { deployments: [] },
            { deployments: [deployment('dpl_building', 'BUILDING')] },
            { deployments: [deployment('dpl_failed', 'ERROR')] },
        ];
        const fetchImpl = vi.fn(async () => jsonResponse(responses.shift()!));
        const client = createVercelClient({ token: 'secret', fetchImpl });

        await expect((client as any).lookupDeploymentByMetadata({
            projectId: 'prj_1', happyPreviewId: 'preview-1', publicationAttemptId: 'attempt-1',
        })).resolves.toEqual({ visibility: 'not_found' });
        await expect((client as any).lookupDeploymentByMetadata({
            projectId: 'prj_1', happyPreviewId: 'preview-1', publicationAttemptId: 'attempt-1',
        })).resolves.toMatchObject({ visibility: 'in_progress', deployment: { id: 'dpl_building', readyState: 'BUILDING' } });
        await expect((client as any).lookupDeploymentByMetadata({
            projectId: 'prj_1', happyPreviewId: 'preview-1', publicationAttemptId: 'attempt-1',
        })).resolves.toMatchObject({ visibility: 'terminal', deployment: { id: 'dpl_failed', readyState: 'ERROR' } });

        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('waits for a reconciled deployment to become ready instead of treating its build URL as published', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ deployments: [{
                id: 'dpl_building', url: 'building.vercel.app', readyState: 'BUILDING', target: null, aliasAssigned: false,
                meta: { happyPreviewId: 'preview-1', happyPublicationAttemptId: 'attempt-1' },
            }] }))
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_building', url: 'building.vercel.app', readyState: 'READY', target: null, aliasAssigned: false }));
        const client = createVercelClient({ token: 'secret', fetchImpl, sleep: async () => {}, pollIntervalMs: 0 });

        const lookup = await (client as any).lookupDeploymentByMetadata({
            projectId: 'prj_1', happyPreviewId: 'preview-1', publicationAttemptId: 'attempt-1',
        });
        expect(lookup).toMatchObject({ visibility: 'in_progress', deployment: { id: 'dpl_building', readyState: 'BUILDING' } });
        await expect((client as any).waitForDeploymentReady(lookup.deployment))
            .resolves.toEqual({ id: 'dpl_building', url: 'https://building.vercel.app', readyState: 'READY' });

        expect((fetchImpl as any).mock.calls.map(([url]: [string]) => url)).toEqual([
            'https://api.vercel.com/v6/deployments?projectId=prj_1&meta-happyPreviewId=preview-1&meta-happyPublicationAttemptId=attempt-1',
            'https://api.vercel.com/v13/deployments/dpl_building',
        ]);
    });

    it('does not automatically retry the non-idempotent deployment create request', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'temporary_unavailable' } }, 503));
        const client = createVercelClient({ token: 'secret', fetchImpl, sleep: async () => {} });

        await expect(client.createDeployment({
            name: 'happy-previews', files: [{ file: 'index.html', sha: 'b'.repeat(64), size: 42 }], meta: {},
        })).rejects.toMatchObject({ code: 'temporary_unavailable', status: 503 });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('persists the validated deployment id before polling Vercel readiness', async () => {
        let persistedId: string | undefined;
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_tracked', url: 'preview.vercel.app', readyState: 'BUILDING', target: null, aliasAssigned: false }))
            .mockImplementationOnce(async () => {
                if (persistedId !== 'dpl_tracked') throw new Error('deployment id was not persisted before polling');
                return jsonResponse({ id: 'dpl_tracked', url: 'preview.vercel.app', readyState: 'READY', target: null, aliasAssigned: false });
            });
        const client = createVercelClient({ token: 'secret', fetchImpl, sleep: async () => {} });

        await client.createDeployment({
            name: 'happy-previews', files: [{ file: 'index.html', sha: '0'.repeat(64), size: 1 }], meta: {},
            onCreated: async ({ id }) => { persistedId = id; },
        });
        expect(persistedId).toBe('dpl_tracked');
    });

    it('does not poll an untracked deployment when created-id persistence fails', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ id: 'dpl_untracked', url: 'preview.vercel.app', readyState: 'BUILDING', target: null, aliasAssigned: false }));
        const client = createVercelClient({ token: 'secret', fetchImpl, sleep: async () => { throw new Error('unexpected poll'); } });

        await expect(client.createDeployment({
            name: 'happy-previews', files: [{ file: 'index.html', sha: '9'.repeat(64), size: 1 }], meta: {},
            onCreated: async () => { throw new Error('durable persistence failed'); },
        })).rejects.toThrow('durable persistence failed');
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it.each([
        [{ id: 'dpl_target', url: 'preview.vercel.app', readyState: 'READY', target: 'staging', aliasAssigned: false }, 'staging target'],
        [{ id: 'dpl_custom', url: 'preview.vercel.app', readyState: 'READY', target: 'custom', aliasAssigned: false }, 'custom target'],
        [{ id: 'dpl_missing', url: 'preview.vercel.app', readyState: 'READY' }, 'missing target'],
        [{ id: 'dpl_alias', url: 'preview.vercel.app', readyState: 'READY', target: null, alias: ['preview.example.com'], aliasAssigned: false }, 'unexpected alias'],
    ])('rejects %s so only unaliased preview deployments are accepted', async (response, _label) => {
        const client = createVercelClient({ token: 'secret', fetchImpl: vi.fn(async () => jsonResponse(response)) });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: '1'.repeat(64), size: 1 }], meta: {} }))
            .rejects.toThrow(/preview|alias|target/i);
    });

    it.each([
        { id: 'dpl_alias_assigned', url: 'preview.vercel.app', readyState: 'READY', target: null, aliasAssigned: true },
        { id: 'dpl_alias_missing', url: 'preview.vercel.app', readyState: 'READY', target: null },
    ])('rejects deployment responses without aliasAssigned: false', async (response) => {
        const client = createVercelClient({ token: 'secret', fetchImpl: vi.fn(async () => jsonResponse(response)) });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: '5'.repeat(64), size: 1 }], meta: {} }))
            .rejects.toThrow(/alias/i);
    });

    it.each(['DELETED', 'UNKNOWN'])('rejects terminal or unknown Vercel state %s without publishing a URL', async (readyState) => {
        const client = createVercelClient({
            token: 'secret', fetchImpl: vi.fn(async () => jsonResponse({ id: 'dpl_state', url: 'preview.vercel.app', readyState, target: null, aliasAssigned: false })),
            sleep: async () => { throw new Error('unexpected polling'); },
        });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: '2'.repeat(64), size: 1 }], meta: {} }))
            .rejects.toThrow(/terminal|invalid/i);
    });

    it('caps sleep to the remaining readiness deadline and does not poll after it expires', async () => {
        let clock = 0;
        const fetchImpl = vi.fn(async () => jsonResponse({ id: 'dpl_deadline', url: 'preview.vercel.app', readyState: 'BUILDING', target: null, aliasAssigned: false }));
        const sleep = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
        const timeoutSignal = vi.fn(() => new AbortController().signal);
        const client = createVercelClient({ token: 'secret', fetchImpl, now: () => clock, sleep, pollIntervalMs: 1_000, deploymentTimeoutMs: 100, timeoutSignal });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: '3'.repeat(64), size: 1 }], meta: {} }))
            .rejects.toThrow(/timed out/i);
        expect(sleep).toHaveBeenCalledWith(100);
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(timeoutSignal).toHaveBeenCalledWith(100);
    });

    it('caps each poll request to the remaining deadline and rejects a late READY response', async () => {
        let clock = 0;
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_late', url: 'preview.vercel.app', readyState: 'BUILDING', target: null, aliasAssigned: false }))
            .mockImplementationOnce(async () => { clock = 101; return jsonResponse({ id: 'dpl_late', url: 'preview.vercel.app', readyState: 'READY', target: null, aliasAssigned: false }); });
        const timeoutSignal = vi.fn(() => new AbortController().signal);
        const client = createVercelClient({ token: 'secret', fetchImpl, now: () => clock, sleep: async () => { clock = 90; }, pollIntervalMs: 90, deploymentTimeoutMs: 100, timeoutSignal });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: '4'.repeat(64), size: 1 }], meta: {} }))
            .rejects.toThrow(/timed out/i);
        expect(timeoutSignal).toHaveBeenNthCalledWith(1, 100);
        expect(timeoutSignal).toHaveBeenNthCalledWith(2, 10);
    });

    it('polls a preview deployment until Vercel confirms it is ready', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_wait', url: 'happy-preview.vercel.app', readyState: 'BUILDING', target: null, aliasAssigned: false }))
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_wait', url: 'happy-preview.vercel.app', readyState: 'READY', target: null, aliasAssigned: false }));
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
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_failed', url: 'happy-preview.vercel.app', readyState: 'QUEUED', target: null, aliasAssigned: false }))
            .mockResolvedValueOnce(jsonResponse({ id: 'dpl_failed', url: 'happy-preview.vercel.app', readyState: 'ERROR', target: null, aliasAssigned: false }));
        const client = createVercelClient({ token: 'secret', fetchImpl, sleep: async () => {}, pollIntervalMs: 0 });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: 'e'.repeat(64), size: 1 }], meta: {} }))
            .rejects.toThrow(/terminal/i);
    });

    it('times out an unready Vercel deployment instead of returning an unverified URL', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ id: 'dpl_slow', url: 'happy-preview.vercel.app', readyState: 'BUILDING', target: null, aliasAssigned: false }));
        const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(101);
        const client = createVercelClient({ token: 'secret', fetchImpl, now, sleep: async () => {}, pollIntervalMs: 0, deploymentTimeoutMs: 100 });

        await expect(client.createDeployment({ name: 'happy-previews', files: [{ file: 'index.html', sha: 'f'.repeat(64), size: 1 }], meta: {} }))
            .rejects.toThrow(/timed out/i);
        expect(fetchImpl).toHaveBeenCalledOnce();
    });

    it('rejects an unexpected production deployment response', async () => {
        const client = createVercelClient({
            token: 'secret',
            fetchImpl: vi.fn(async (_url: string, _init?: any) => jsonResponse({ id: 'dpl_2', url: 'prod.vercel.app', readyState: 'READY', target: 'production', aliasAssigned: false })),
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

    it('honors Retry-After before retrying a transient Vercel rate limit', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limited' } }), { status: 429, headers: { 'retry-after': '2' } }))
            .mockResolvedValueOnce(jsonResponse({}));
        const sleep = vi.fn(async () => {});
        const client = createVercelClient({ token: 'secret', fetchImpl, sleep });

        await expect(client.uploadFile('a'.repeat(64), new Uint8Array([1]), 'text/plain')).resolves.toBeUndefined();
        expect(sleep).toHaveBeenCalledWith(2000);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('uses exponential fallback only when Retry-After is absent and accepts HTTP-date Retry-After', async () => {
        const sleep = vi.fn(async () => {}); const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: { code: 'rate_limited' } }, 429))
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'rate_limited' } }), { status: 429, headers: { 'retry-after': 'Thu, 01 Jan 1970 00:00:02 GMT' } }))
            .mockResolvedValueOnce(jsonResponse({}));
        const client = createVercelClient({ token: 'secret', fetchImpl, sleep, now: () => 1_000 });
        await client.uploadFile('b'.repeat(64), new Uint8Array([1]), 'text/plain');
        expect(sleep).toHaveBeenNthCalledWith(1, 250);
        expect(sleep).toHaveBeenNthCalledWith(2, 1000);
    });

    it('treats an already removed deployment as a successful idempotent delete', async () => {
        const client = createVercelClient({ token: 'secret', fetchImpl: vi.fn(async () => jsonResponse({ error: { code: 'not_found' } }, 404)) });

        await expect(client.deleteDeployment('dpl_removed')).resolves.toBeUndefined();
    });

    it('rejects unsafe provider identifiers before building a URL', async () => {
        const fetchImpl = vi.fn(async (_url: string, _init?: any) => jsonResponse({}));
        const client = createVercelClient({ token: 'secret', fetchImpl });
        await expect(client.deleteDeployment('../projects')).rejects.toThrow(/identifier/i);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
