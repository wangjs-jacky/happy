import type { AuthCredentials } from '@/auth/tokenStorage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAttachmentDownloadSource } from './apiAttachments';

vi.mock('./serverConfig', () => ({
    getServerUrl: () => 'https://api.test',
}));
vi.mock('@/auth/tokenStorage', () => ({}));
vi.mock('./uploadFormFile', () => ({ appendFormFile: vi.fn() }));

const credentials: AuthCredentials = {
    token: 'test-token',
    secret: 'test-secret',
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('requestAttachmentDownloadSource', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shares one request-download call for concurrent consumers', async () => {
        const response = deferred<Response>();
        const fetchMock = vi.fn<typeof fetch>();
        fetchMock.mockReturnValue(response.promise);
        vi.stubGlobal('fetch', fetchMock);

        const first = requestAttachmentDownloadSource(credentials, 'session-1', 'file-1');
        const second = requestAttachmentDownloadSource(credentials, 'session-1', 'file-1');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        response.resolve(jsonResponse({ downloadUrl: 'https://objects.test/file-1' }));
        await expect(Promise.all([first, second])).resolves.toEqual([
            { uri: 'https://objects.test/file-1', headers: {} },
            { uri: 'https://objects.test/file-1', headers: {} },
        ]);
    });

    it('removes a rejected request so a later retry fetches again', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce(jsonResponse({ downloadUrl: 'https://objects.test/file-1' }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(requestAttachmentDownloadSource(credentials, 'session-1', 'file-1'))
            .rejects.toThrow('temporary failure');
        await expect(requestAttachmentDownloadSource(credentials, 'session-1', 'file-1'))
            .resolves.toEqual({ uri: 'https://objects.test/file-1', headers: {} });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
