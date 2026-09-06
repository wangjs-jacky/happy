import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openLocalHistory } from './localHistoryStore';
import { downloadEncryptedAttachment } from './apiAttachments';
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://api.test' }));
vi.mock('@/utils/parseToken', () => ({ parseToken: (token: string) => token }));
vi.mock('./uploadFormFile', () => ({ appendFormFile: vi.fn() }));
const credentials = { token: 'account', secret: 'secret' };
const descriptor = () => new Response(JSON.stringify({ downloadUrl: 'https://oss.test/signed' }));
describe('encrypted attachment download persistence', () => {
    beforeEach(() => { globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange; });
    afterEach(() => vi.unstubAllGlobals());
    it('coalesces byte GETs across variants and skips signature/OSS after reopening the archive', async () => {
        const h = (await openLocalHistory('https://api.test|account'))!;
        const network = vi.fn().mockImplementation(async (url: string) => url.includes('request-download') ? descriptor() : new Response(new Uint8Array([1, 2, 3])));
        vi.stubGlobal('fetch', network);
        const results = await Promise.all([downloadEncryptedAttachment(credentials, 's', 'ref'), downloadEncryptedAttachment(credentials, 's', 'ref')]);
        expect(results).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])]);
        expect(network).toHaveBeenCalledTimes(2);
        h.close();
        const reopened = (await openLocalHistory('https://api.test|account'))!;
        network.mockClear();
        expect(await downloadEncryptedAttachment(credentials, 's', 'ref')).toEqual(new Uint8Array([1, 2, 3]));
        expect(network).not.toHaveBeenCalled(); reopened.close();
    });
    it('does not repopulate or deliver a delayed download after another handle deletes the session', async () => {
        const h = (await openLocalHistory('https://api.test|account'))!;
        let complete!: (value: Response) => void;
        const started = new Promise<void>(resolve => {
            vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
                if (url.includes('request-download')) return descriptor();
                resolve(); return new Promise<Response>(r => { complete = r; });
            }));
        });
        const downloading = downloadEncryptedAttachment(credentials, 'deleted', 'ref');
        await started;
        const other = (await openLocalHistory('https://api.test|account'))!;
        await other.deleteSession('deleted');
        complete(new Response(new Uint8Array([9])));
        await expect(downloading).rejects.toThrow('Attachment context expired');
        expect(await h.readAttachment('deleted', 'ref')).toBeNull(); h.close(); other.close();
    });
});
