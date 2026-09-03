import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://happy.test' }));
vi.mock('./apiSocket', () => ({ getHappyClientId: () => 'web-test' }));
import { disconnectVercelPreview, getVercelPreviewConnectUrl, getVercelPreviewStatus } from './apiInteractivePreviews';

describe('Vercel preview API', () => {
    beforeEach(() => vi.restoreAllMocks());
    it('loads status without exposing credentials', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ available: true, connected: true, account: { teamName: 'Acme' } }), { status: 200 })));
        await expect(getVercelPreviewStatus({ token: 'token', secret: new Uint8Array() } as any)).resolves.toEqual({ available: true, connected: true, account: { teamName: 'Acme' } });
    });
    it('gets the provider URL and disconnects', async () => {
        const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(url.endsWith('/params') ? { url: 'https://vercel.com/install' } : { success: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(getVercelPreviewConnectUrl({ token: 'token' } as any)).resolves.toBe('https://vercel.com/install');
        await disconnectVercelPreview({ token: 'token' } as any);
        expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
    });
});
