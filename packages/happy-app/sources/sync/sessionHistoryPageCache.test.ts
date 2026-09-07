import { describe, expect, it, vi } from 'vitest';
import { MMKV } from 'react-native-mmkv';
import { SessionHistoryPageCache } from './sessionHistoryPageCache';
import type { ApiMessage } from './apiTypes';

const message = (seq: number): ApiMessage => ({ id: `m-${seq}`, seq, localId: null,
    content: { t: 'encrypted', c: `cipher-${seq}` }, createdAt: seq, updatedAt: seq });
const page = (seqs: number[], hasMore = true) => ({ messages: seqs.map(message), hasMore });

describe('durable encrypted history pages', () => {
    it('invalidates a captured session fence only for its own deletion or a full clear', () => {
        const cache = new SessionHistoryPageCache(new MMKV());
        const own = cache.captureFence('a', 's');
        const other = cache.captureFence('a', 'other');
        cache.remove('a', 'other');
        expect(own()).toBe(true);
        expect(other()).toBe(false);
        cache.remove('a', 's');
        expect(own()).toBe(false);
        const reopened = cache.captureFence('a', 's');
        expect(reopened()).toBe(true);
        cache.clear();
        expect(reopened()).toBe(false);
    });

    it('reads saved pages after reopening with no in-memory cache, including a shifted boundary', () => {
        const disk = new MMKV();
        const first = new SessionHistoryPageCache(disk);
        first.save('a', 's', 11, page([8, 9, 10]));
        first.save('a', 's', 8, page([5, 6, 7]));
        const reopened = new SessionHistoryPageCache(disk);
        expect(reopened.readOlder('a', 's', 10, 4)).toEqual(page([6, 7, 8, 9]));
        expect(reopened.readOlder('a', 's', 5)).toBeNull();
    });

    it('preserves confirmed sparse intervals and the earliest edge', () => {
        const cache = new SessionHistoryPageCache(new MMKV());
        cache.save('a', 's', 10, page([2, 5, 8], false));
        expect(cache.readOlder('a', 's', 7)).toEqual(page([2, 5], false));
        expect(cache.readOlder('a', 's', 2)).toEqual(page([], false));
        expect(cache.readOlder('a', 's', 10, 2)).toEqual(page([5, 8], true));
    });

    it('does not bridge a missing interval or mark an unconfirmed empty page complete', () => {
        const cache = new SessionHistoryPageCache(new MMKV());
        cache.save('a', 's', 10, page([8, 9]));
        cache.save('a', 's', 5, page([1, 2, 3, 4], false));
        cache.save('a', 's', 8, page([], true));
        expect(cache.readOlder('a', 's', 10)).toEqual(page([8, 9]));
        expect(cache.readOlder('a', 's', 8)).toBeNull();
    });

    it('archives the former latest page without certifying unseen history above it', () => {
        const cache = new SessionHistoryPageCache(new MMKV());
        cache.save('a', 's', 2147483647, page([8, 9, 10]));
        expect(cache.readOlder('a', 's', 11)).toEqual(page([8, 9, 10]));
        expect(cache.readOlder('a', 's', 12)).toBeNull();
    });

    it('isolates servers/accounts and sessions, and removes only the deleted session', () => {
        const disk = new MMKV();
        const cache = new SessionHistoryPageCache(disk);
        cache.save('a', 's', 10, page([9]));
        cache.save('b', 's', 10, page([8]));
        cache.save('a', 'other', 10, page([7]));
        cache.remove('a', 's');
        expect(new SessionHistoryPageCache(disk).readOlder('a', 's', 10)).toBeNull();
        expect(cache.readOlder('b', 's', 10)).toEqual(page([8]));
        expect(cache.readOlder('a', 'other', 10)).toEqual(page([7]));
        cache.clear();
        expect(new SessionHistoryPageCache(disk).readOlder('b', 's', 10)).toBeNull();
    });

    it('keeps old committed data when a write fails between bytes and index', () => {
        const disk = new MMKV();
        const cache = new SessionHistoryPageCache(disk);
        cache.save('a', 's', 10, page([8, 9]));
        const original = disk.set.bind(disk);
        let writes = 0;
        vi.spyOn(disk, 'set').mockImplementation((key, value) => {
            if (++writes === 2) throw new Error('disk full');
            original(key, value);
        });
        expect(cache.save('a', 's', 8, page([6, 7]))).toBe(false);
        expect(new SessionHistoryPageCache(disk).readOlder('a', 's', 10)).toEqual(page([8, 9]));
        expect(cache.readOlder('a', 's', 8)).toBeNull();
    });

    it('rejects a pending write after clearing or deleting its cached session', () => {
        const cache = new SessionHistoryPageCache(new MMKV());
        const beforeClear = cache.generation;
        cache.clear();
        expect(cache.save('a', 's', 10, page([9]), beforeClear)).toBe(false);
        const beforeDelete = cache.generation;
        cache.remove('a', 's');
        expect(cache.save('a', 's', 10, page([9]), beforeDelete)).toBe(false);
        expect(cache.readOlder('a', 's', 10)).toBeNull();
    });

    it('treats missing/corrupt bytes as a cache miss, never as empty confirmed history', () => {
        const disk = new MMKV();
        const cache = new SessionHistoryPageCache(disk);
        cache.save('a', 's', 10, page([8, 9], false));
        const get = disk.getString.bind(disk);
        vi.spyOn(disk, 'getString').mockImplementation(key => {
            const value = get(key);
            return value?.includes('cipher-') ? '{broken' : value;
        });
        expect(cache.readOlder('a', 's', 10)).toBeNull();
    });

    it('does not rewrite identical pages and refuses to exceed the disk budget', () => {
        const disk = new MMKV();
        const cache = new SessionHistoryPageCache(disk);
        cache.save('a', 's', 10, page([8, 9]));
        const set = vi.spyOn(disk, 'set');
        expect(cache.save('a', 's', 10, page([8, 9]))).toBe(true);
        expect(set).not.toHaveBeenCalled();
        const full = new SessionHistoryPageCache(disk, 1);
        expect(full.save('a', 's', 8, page([6, 7]))).toBe(false);
        expect(full.readOlder('a', 's', 10)).toEqual(page([8, 9]));
    });

    it('accounts for the complete growing index when admitting a page to the disk budget', () => {
        class AppendByteDisk extends MMKV {
            bytes = 0;
            override set(key: string, value: string | number | boolean | ArrayBuffer) {
                this.bytes += new TextEncoder().encode(key + String(value)).length + 8;
                super.set(key, value);
            }
            override get size() { return this.bytes; }
        }
        const disk = new AppendByteDisk();
        const cache = new SessionHistoryPageCache(disk);
        for (let seq = 2; seq <= 400; seq += 2) cache.save('a', 's', seq + 1, page([seq]));
        const budget = disk.size + 5000;
        const nearlyFull = new SessionHistoryPageCache(disk, budget);
        expect(nearlyFull.save('a', 's', 1001, page([1000]))).toBe(false);
        expect(disk.size).toBeLessThanOrEqual(budget);
    });
});
