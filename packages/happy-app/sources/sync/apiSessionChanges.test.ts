import { afterEach, expect, it, vi } from 'vitest';
import { fetchSessionChanges } from './apiSessionChanges';
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://test' }));
vi.mock('./apiSocket', () => ({ getHappyClientId: () => 'web' }));
afterEach(() => vi.unstubAllGlobals());
const credentials = { token: 'token', secret: 'secret' };
it('omits the initial cursor and preserves opaque resume tokens', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
        requests.push(url);
        return new Response(JSON.stringify({ changes: [], nextCursor: 'a+b/c=', hasMore: false }));
    });
    expect(await fetchSessionChanges(credentials)).toEqual({ kind: 'page', changes: [], nextCursor: 'a+b/c=', hasMore: false });
    await fetchSessionChanges(credentials, 'a+b/c=');
    expect(requests).toEqual(['https://test/v3/sessions/changes?limit=200',
        'https://test/v3/sessions/changes?limit=200&cursor=a%2Bb%2Fc%3D']);
});
it.each([[404, 'unsupported'], [405, 'unsupported'], [501, 'unsupported'], [409, 'reset']] as const)(
    'classifies status %s without treating it as a deletion', async (status, kind) => {
        vi.stubGlobal('fetch', async () => new Response('{}', { status }));
        expect(await fetchSessionChanges(credentials)).toEqual({ kind });
    });
it('does not downgrade transient failures to old-server capability absence', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
    await expect(fetchSessionChanges(credentials)).rejects.toThrow('503');
});
