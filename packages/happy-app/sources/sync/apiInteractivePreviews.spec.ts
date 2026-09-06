import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.test' }));
vi.mock('./apiSocket', () => ({ getHappyClientId: () => 'web-test' }));
import {
    VercelPreviewApiError,
    disconnectVercelPreview,
    getVercelPreviewConnectUrl,
    getVercelPreviewStatus,
} from './apiInteractivePreviews';

describe('Vercel preview API', () => {
    beforeEach(() => vi.restoreAllMocks());
    it('loads status without exposing credentials', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ available: true, connected: true, account: { teamId: 'team_1', teamName: 'Acme', projectId: 'prj_1' } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(getVercelPreviewStatus({ token: 'token', secret: new Uint8Array() } as any)).resolves.toEqual({ available: true, connected: true, account: { teamId: 'team_1', teamName: 'Acme', projectId: 'prj_1' } });
        expect(fetchMock).toHaveBeenCalledWith('https://happy.test/v1/connect/vercel/status', expect.objectContaining({
            headers: { Authorization: 'Bearer token', 'X-Happy-Client': 'web-test' },
        }));
    });
    it('gets the provider URL and disconnects', async () => {
        const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(url.endsWith('/params') ? { url: 'https://vercel.com/install' } : { success: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(getVercelPreviewConnectUrl({ token: 'token' } as any)).resolves.toBe('https://vercel.com/install');
        await disconnectVercelPreview({ token: 'token' } as any);
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
    });

    it('returns only the server cleanup warning after disconnecting', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: true,
            warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING',
        }), { status: 200 })));

        await expect(disconnectVercelPreview({ token: 'token' } as any)).resolves.toEqual({
            warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING',
        });
    });

    it('classifies unavailable, expired credentials, and network failures without exposing response text', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'VERCEL_NOT_CONFIGURED secret=never-show-this' }), { status: 400 })));
        await expect(getVercelPreviewConnectUrl({ token: 'token' } as any)).rejects.toMatchObject({
            name: 'VercelPreviewApiError',
            kind: 'unavailable',
            message: 'Temporary previews are not configured on this Happy Server.',
        } satisfies Partial<VercelPreviewApiError>);

        vi.stubGlobal('fetch', vi.fn(async () => new Response('expired credential', { status: 401 })));
        await expect(getVercelPreviewStatus({ token: 'token' } as any)).rejects.toMatchObject({
            kind: 'credentials',
            message: 'Your sign-in has expired. Sign in again and retry.',
        } satisfies Partial<VercelPreviewApiError>);

        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('socket password=never-show-this'); }));
        await expect(disconnectVercelPreview({ token: 'token' } as any)).rejects.toMatchObject({
            kind: 'network',
            message: 'Unable to reach Happy Server. Check your connection and retry.',
        } satisfies Partial<VercelPreviewApiError>);
    });

    it('rejects a malformed or unsafe provider URL before it reaches a browser', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: 'javascript:alert(1)' }), { status: 200 })));
        await expect(getVercelPreviewConnectUrl({ token: 'token' } as any)).rejects.toMatchObject({
            kind: 'server',
            message: 'Happy Server returned an invalid Vercel connection URL.',
        } satisfies Partial<VercelPreviewApiError>);
    });
});
