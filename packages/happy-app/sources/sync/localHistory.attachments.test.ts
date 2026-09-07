import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openLocalHistory } from './localHistoryStore';

describe('persistent encrypted attachment bytes', () => {
    beforeEach(() => { globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange; });
    it('reopens ciphertext, isolates scope/ref tuples, and evicts within a byte budget', async () => {
        const h = (await openLocalHistory('server|a'))!;
        expect(await h.writeAttachment('s', 'ref', new Uint8Array([1, 2, 3]), h.captureSessionFence('s'), 5)).toBe(true);
        h.close();
        const reopened = (await openLocalHistory('server|a'))!;
        expect(await reopened.readAttachment('s', 'ref')).toEqual(new Uint8Array([1, 2, 3]));
        const other = (await openLocalHistory('server|b'))!;
        expect(await other.readAttachment('s', 'ref')).toBeNull();
        expect(await reopened.writeAttachment('s', 'next', new Uint8Array([4, 5, 6]), reopened.captureSessionFence('s'), 5)).toBe(true);
        expect(await reopened.readAttachment('s', 'ref')).toBeNull();
        expect(await reopened.readAttachment('s', 'next')).toEqual(new Uint8Array([4, 5, 6]));
        expect(await reopened.writeAttachment('s', 'huge', new Uint8Array(6), reopened.captureSessionFence('s'), 5)).toBe(false);
        reopened.close(); other.close();
    });
    it('atomically fences deletion, reconciliation tombstones and reset from another database handle', async () => {
        for (const operation of ['delete', 'reconcile', 'reset']) {
            const a = (await openLocalHistory(operation))!;
            const b = (await openLocalHistory(operation))!;
            const stale = a.captureSessionFence('s');
            await a.writeAttachment('s', 'existing', new Uint8Array([1]), stale);
            if (operation === 'delete') await b.deleteSession('s');
            if (operation === 'reconcile') await b.commitReconciliation({ changes: [{ sessionId: 's', revision: '1', deleted: true, lastMessageSeq: 1, metadataVersion: 0, agentStateVersion: 0 }], nextCursor: '1' });
            if (operation === 'reset') await b.clear();
            expect(await a.writeAttachment('s', 'late', new Uint8Array([2]), stale)).toBe(false);
            expect(await a.readAttachment('s', 'existing')).toBeNull();
            const c = (await openLocalHistory(operation))!;
            expect(await c.readAttachment('s', 'late')).toBeNull();
            a.close(); b.close(); c.close();
        }
    });
});
