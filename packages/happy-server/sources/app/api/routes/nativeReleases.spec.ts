import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeReleaseCatalog } from '@/app/api/routes/nativeReleases';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
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
});
