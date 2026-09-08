import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeReleaseCatalog } from '@/app/api/routes/nativeReleases';

const tag = 'android-v1.7.1-runtimes23-24-3906949b';
const apkName = 'paws-production-v1.7.1-runtime24-3906949b-arm64.apk';
const apkUrl = `https://github.com/wangjs-jacky/happy/releases/download/${tag}/${apkName}`;
const githubRelease = {
    tag_name: tag,
    draft: false,
    prerelease: false,
    target_commitish: '3906949b26293701d16d2c159eb6faaac081a1a2',
    published_at: '2026-09-05T19:48:00Z',
    assets: [
        { name: apkName, state: 'uploaded', size: 150830486, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: apkUrl },
        { name: apkName + '.verification.json', state: 'uploaded', size: 500, browser_download_url: apkUrl + '.verification.json' },
    ],
};
const verificationMetadata = {
    apk: apkName,
    variant: 'production',
    package: 'build.paws',
    channel: 'production',
    runtimeVersion: '24',
    version: '1.7.1',
    size: 150830486,
    sha256: 'a'.repeat(64),
    abis: ['arm64-v8a'],
    zipValid: true,
    signatureV2Valid: true,
    bluetoothUncapped: true,
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('GitHub release request lifecycle', () => {
    it('coalesces concurrent checks and caches the successful catalog', async () => {
        let resolve!: (response: Response) => void;
        const request = vi.fn(() => new Promise<Response>(r => { resolve = r; }));
        vi.stubGlobal('fetch', request);
        const getCatalog = createNativeReleaseCatalog();
        const first = getCatalog();
        const second = getCatalog();
        resolve(new Response('[]'));
        expect(await first).toEqual([]);
        expect(await second).toEqual([]);
        expect(await getCatalog()).toEqual([]);
        expect(request).toHaveBeenCalledOnce();
    });
    it('backs off failures without caching them as a successful empty catalog', async () => {
        vi.useFakeTimers();
        const request = vi.fn(async () => new Response('[]', { status: 503 }));
        vi.stubGlobal('fetch', request);
        const getCatalog = createNativeReleaseCatalog();
        await expect(getCatalog()).rejects.toThrow();
        await expect(getCatalog()).rejects.toThrow();
        expect(request).toHaveBeenCalledOnce();
        request.mockImplementation(async () => new Response('[]'));
        await vi.advanceTimersByTimeAsync(30_001);
        expect(await getCatalog()).toEqual([]);
        expect(request).toHaveBeenCalledTimes(2);
    });
    it('rejects malformed GitHub responses', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"unavailable"}')));
        await expect(createNativeReleaseCatalog()()).rejects.toThrow('Invalid GitHub release response');
    });

    it('gives sidecar verification a fresh deadline after the release catalog phase', async () => {
        const controllers: AbortController[] = [];
        vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
            const controller = new AbortController();
            controllers.push(controller);
            return controller.signal;
        });
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.startsWith('https://api.github.com/')) {
                controllers[0].abort();
                return new Response(JSON.stringify([githubRelease]));
            }
            if (init?.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
            return new Response(JSON.stringify(verificationMetadata));
        }));

        await expect(createNativeReleaseCatalog()()).resolves.toMatchObject([
            { channel: 'production', version: '1.7.1', runtime: 24, url: apkUrl },
        ]);
    });

    it('serves the last verified catalog when a refresh cannot reach GitHub', async () => {
        vi.useFakeTimers();
        let githubAvailable = true;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.startsWith('https://api.github.com/')) {
                return githubAvailable
                    ? new Response(JSON.stringify([githubRelease]))
                    : new Response('unavailable', { status: 503 });
            }
            return new Response(JSON.stringify(verificationMetadata));
        }));
        const getCatalog = createNativeReleaseCatalog();
        const verified = await getCatalog();
        githubAvailable = false;
        await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);

        await expect(getCatalog()).resolves.toEqual(verified);
    });

    it('does not serve a verified catalog after the stale safety window', async () => {
        vi.useFakeTimers();
        let githubAvailable = true;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.startsWith('https://api.github.com/')) {
                return githubAvailable
                    ? new Response(JSON.stringify([githubRelease]))
                    : new Response('unavailable', { status: 503 });
            }
            return new Response(JSON.stringify(verificationMetadata));
        }));
        const getCatalog = createNativeReleaseCatalog();
        await getCatalog();
        githubAvailable = false;
        await vi.advanceTimersByTimeAsync(60 * 60_000 + 1);

        await expect(getCatalog()).rejects.toThrow('GitHub release check failed: 503');
    });
});
