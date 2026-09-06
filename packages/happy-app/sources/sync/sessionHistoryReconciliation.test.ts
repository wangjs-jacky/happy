import { beforeEach, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openLocalHistory } from './localHistoryStore';
import { reconcileSessionHistory } from './sessionHistoryReconciliation';
import type { ApiSessionSnapshot } from './apiTypes';
beforeEach(() => { globalThis.indexedDB = new IDBFactory(); globalThis.IDBKeyRange = IDBKeyRange; });
const snapshot: ApiSessionSnapshot = { id: 's', seq: 100, metadata: 'cipher', metadataVersion: 1,
    agentState: null, agentStateVersion: 0, dataEncryptionKey: null, active: false, activeAt: 0, createdAt: 0, updatedAt: 0 };
it('does not restore a cleared scope from a late changes response', async () => {
    const history = (await openLocalHistory('cleared'))!;
    const applied: string[] = [];
    await reconcileSessionHistory(history, {
        fetchChanges: async () => {
            await history.clear();
            return { kind: 'page', changes: [{ sessionId: 's', revision: '1', deleted: false,
                lastMessageSeq: 10, metadataVersion: 1, agentStateVersion: 0 }], nextCursor: 'late', hasMore: false };
        },
        fetchSnapshot: async () => snapshot,
        applySnapshot: async value => { applied.push(value.id); }, deleteSession: () => {},
    });
    const reopened = (await openLocalHistory('cleared'))!;
    expect((await reopened.readReconciliation()).cursor).toBeNull();
    expect(await reopened.readSnapshot('s')).toBeNull();
    expect(applied).toEqual([]);
    reopened.close();
});
it('preserves histories on reset and verifies pre-protocol deletions with point lookups', async () => {
    const history = (await openLocalHistory('a'))!;
    await history.writeSnapshots([snapshot, { ...snapshot, id: 'gone' }]);
    await history.commitReconciliation({ changes: [], nextCursor: 'old' });
    const cursors: Array<string | undefined> = [];
    const deleted: string[] = [];
    const checked: string[] = [];
    const result = await reconcileSessionHistory(history, {
        fetchChanges: async cursor => {
            cursors.push(cursor);
            return cursor ? { kind: 'reset' } : { kind: 'page', changes: [{ sessionId: 's', revision: '1', deleted: false,
                lastMessageSeq: 10, metadataVersion: 1, agentStateVersion: 0 }], nextCursor: 'new', hasMore: false };
        },
        fetchSnapshot: async id => { checked.push(id); return null; },
        applySnapshot: async () => {}, deleteSession: id => { deleted.push(id); },
    });
    expect(result).toBe('supported');
    expect(cursors).toEqual(['old', undefined]);
    expect(checked).toEqual(['gone']);
    expect(deleted).toEqual(['gone']);
    expect((await history.readSnapshot('s'))?.metadata).toBe('cipher');
});
it('replays durable pending snapshot invalidations after interruption without body requests', async () => {
    const history = (await openLocalHistory('a'))!;
    await history.writeSnapshots([snapshot]);
    await history.commitReconciliation({ changes: [{ sessionId: 's', revision: '2', deleted: false,
        lastMessageSeq: 10, metadataVersion: 2, agentStateVersion: 0 }], nextCursor: '2' });
    let fetched = 0;
    await reconcileSessionHistory(history, {
        fetchChanges: async () => ({ kind: 'page', changes: [], nextCursor: '2', hasMore: false }),
        fetchSnapshot: async () => { fetched++; return { ...snapshot, metadataVersion: 2 }; },
        applySnapshot: async () => {}, deleteSession: () => {},
    });
    expect(fetched).toBe(1);
    expect((await history.readSnapshot('s'))?.metadataVersion).toBe(2);
});

it.each([false, true])('discovers unseen session snapshots including after a committed-cursor restart (%s)', async restarted => {
    let history = (await openLocalHistory('discovery'))!;
    const changes = [{ sessionId: 'new', revision: '4', deleted: false, lastMessageSeq: 7, metadataVersion: 1, agentStateVersion: 0 }];
    if (restarted) {
        await history.commitReconciliation({ changes, nextCursor: '4' });
        history.close();
        history = (await openLocalHistory('discovery'))!;
    }
    const applied: string[] = [];
    const fetched: string[] = [];
    await reconcileSessionHistory(history, {
        fetchChanges: async () => ({ kind: 'page', changes: restarted ? [] : changes, nextCursor: '4', hasMore: false }),
        fetchSnapshot: async id => { fetched.push(id); return { ...snapshot, id }; },
        applySnapshot: async value => { applied.push(value.id); }, deleteSession: () => {},
    });
    expect(fetched).toEqual(['new']);
    expect(applied).toEqual(['new']);
    expect((await history.readSnapshot('new'))?.id).toBe('new');
});
