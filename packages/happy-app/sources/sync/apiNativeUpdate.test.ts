import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkNativeAppUpdate } from './apiNativeUpdate';

const identity = { platform: 'android', appId: 'build.paws', version: '1.7.1', runtimeVersion: '23', channel: 'production' };
const url = 'https://github.com/wangjs-jacky/happy/releases/download/android-v1.7.1-runtimes23-24-3906949b/paws-production-v1.7.1-runtime24-3906949b-arm64.apk';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function respond(data: unknown, status = 200) {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(data), { status }));
    vi.stubGlobal('fetch', request);
    return request;
}
describe('native upgrade client', () => {
    it('uses the runtime-aware wire contract and accepts the GitHub APK', async () => {
        const request = respond({ status: 'update-available', update_required: true, update_url: url, updateUrl: url, version: '1.7.1', runtime_version: '24' });
        expect(await checkNativeAppUpdate('https://server.test', identity)).toEqual({ status: 'update-available', available: true, updateUrl: url });
        expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toEqual({ platform: 'android', version: '1.7.1', app_id: 'build.paws', channel: 'production', runtime_version: '23' });
    });
    it.each([
        'https://play.google.com/store/apps/details?id=com.ex3ndr.happy',
        'https://github.com/other/repo/releases/download/tag/file.apk',
        url.replace('paws-production-', 'paws-preview-'),
    ])('rejects untrusted or wrong-package downloads: %s', async update_url => {
        respond({ status: 'update-available', update_required: true, update_url });
        await expect(checkNativeAppUpdate('https://server.test', identity)).rejects.toThrow();
    });
    it('only calls a matching explicit status up to date', async () => {
        respond({ status: 'up-to-date', update_required: false, update_url: null, updateUrl: null });
        expect(await checkNativeAppUpdate('https://server.test', identity)).toEqual({ status: 'up-to-date', available: false });
    });
    it.each([{ updateUrl: null }, { status: 'unknown', update_required: false, update_url: null }])('does not turn an inconclusive response into up to date', async data => {
        respond(data);
        await expect(checkNativeAppUpdate('https://server.test', identity)).rejects.toThrow();
    });
    it('reports failed version checks as errors', async () => {
        respond({ status: 'unknown' }, 503);
        await expect(checkNativeAppUpdate('https://server.test', identity)).rejects.toThrow();
    });
    it('does not query native updates from web', async () => {
        const request = respond({});
        expect(await checkNativeAppUpdate('https://server.test', { ...identity, platform: 'web' })).toEqual({ status: 'unsupported', available: false });
        expect(request).not.toHaveBeenCalled();
    });
    it.each([
        { status: 'update-available', update_required: false, update_url: url, updateUrl: url },
        { status: 'update-available', update_required: true, update_url: url, updateUrl: 'https://example.com' },
        { status: 'up-to-date', update_required: false, update_url: null, updateUrl: url },
    ])('rejects contradictory wire fields', async data => {
        respond(data);
        await expect(checkNativeAppUpdate('https://server.test', identity)).rejects.toThrow();
    });
    it('aborts a stalled mobile request within the deadline', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })));
        const result = expect(checkNativeAppUpdate('https://server.test', identity)).rejects.toThrow('aborted');
        await vi.advanceTimersByTimeAsync(10_000);
        await result;
    });
    it('rejects an older APK even if it comes from the correct GitHub repository', async () => {
        const oldUrl = url.replace('runtime24-', 'runtime22-');
        respond({ status: 'update-available', update_required: true, update_url: oldUrl, updateUrl: oldUrl, version: '1.7.1', runtime_version: '22' });
        await expect(checkNativeAppUpdate('https://server.test', identity)).rejects.toThrow();
    });
    it('rejects conflicting target metadata and filenames', async () => {
        respond({ status: 'update-available', update_required: true, update_url: url, updateUrl: url, version: '1.7.1', runtime_version: '25' });
        await expect(checkNativeAppUpdate('https://server.test', identity)).rejects.toThrow();
    });
    it('rejects contradictory unsupported responses', async () => {
        respond({ status: 'unsupported', update_required: true, update_url: url, updateUrl: url });
        await expect(checkNativeAppUpdate('https://server.test', identity)).rejects.toThrow();
    });
});
