import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./serverConfig', () => ({ getServerUrl: vi.fn(() => 'https://happy.test') }));
vi.mock('./apiSocket', () => ({ getHappyClientId: () => 'web-test' }));
import { connectCloudflarePreview, disconnectCloudflarePreview, getCloudflarePreviewStatus } from './apiInteractivePreviews';
import { getServerUrl } from './serverConfig';

describe('Cloudflare preview API', () => {
    it('refuses to transmit a provider token over a remote plaintext server connection', async () => {
        vi.mocked(getServerUrl).mockReturnValueOnce('http://happy.example:3005');
        const request = vi.fn();
        vi.stubGlobal('fetch', request);
        await expect(connectCloudflarePreview({ token: 'token' } as any, 'account', 'provider-token')).rejects.toMatchObject({ kind: 'insecure' });
        expect(request).not.toHaveBeenCalled();
    });
    afterEach(() => vi.unstubAllGlobals());
    it('sends the token only in the authenticated connection request body', async () => {
        const request = vi.fn(async () => new Response(JSON.stringify({ success: true })));
        vi.stubGlobal('fetch', request);
        await connectCloudflarePreview({ token: 'happy-token' } as any, 'a'.repeat(32), 'private-api-token');
        expect(request).toHaveBeenCalledWith('https://happy.test/v1/connect/cloudflare', {
            method: 'POST', headers: { Authorization: 'Bearer happy-token', 'X-Happy-Client': 'web-test', 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: 'a'.repeat(32), apiToken: 'private-api-token' }),
        });
    });
    it('returns status and cleanup warnings without provider credentials', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ available: true, connected: false }))));
        await expect(getCloudflarePreviewStatus({ token: 'token' } as any)).resolves.toEqual({ available: true, connected: false });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, warning: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' }))));
        await expect(disconnectCloudflarePreview({ token: 'token' } as any)).resolves.toEqual({ warning: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' });
    });
    it('never exposes provider response errors', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('private-api-token', { status: 400 })));
        await expect(connectCloudflarePreview({ token: 'token' } as any, 'a'.repeat(32), 'token')).rejects.toMatchObject({ kind: 'credentials', message: 'Invalid Cloudflare account or API token.' });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('private-api-token'); }));
        await expect(disconnectCloudflarePreview({ token: 'token' } as any)).rejects.toMatchObject({ kind: 'network', message: 'Unable to reach Happy Server. Check your connection and retry.' });
    });
    it('rejects malformed connection success responses', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: 'javascript:alert(1)' }))));
        await expect(connectCloudflarePreview({ token: 'token' } as any, 'account', 'token')).rejects.toMatchObject({ kind: 'server' });
    });
});
