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

it('advances hundreds of unseen changes without snapshot requests while refreshing known stale snapshots and deleting known tombstones', async () => {
    const history = (await openLocalHistory('discovery'))!;
    await history.writeSnapshots([snapshot, { ...snapshot, id: 'gone' }]);
    await history.commitReconciliation({ changes: [{ sessionId: 'gone', revision: '1', deleted: false,
        lastMessageSeq: 10, metadataVersion: 1, agentStateVersion: 0 }], nextCursor: 'old' });
    const unseen = Array.from({ length: 174 }, (_, index) => ({
        sessionId: `unseen-${index}`, revision: '1', deleted: false,
        lastMessageSeq: index, metadataVersion: 1, agentStateVersion: 0,
    }));
    const changes = [
        ...unseen,
        { sessionId: 's', revision: '2', deleted: false, lastMessageSeq: 10, metadataVersion: 2, agentStateVersion: 0 },
        { sessionId: 'gone', revision: '2', deleted: true, lastMessageSeq: 10, metadataVersion: 1, agentStateVersion: 0 },
    ];
    const applied: string[] = [];
    const fetched: string[] = [];
    const deleted: string[] = [];
    await reconcileSessionHistory(history, {
        fetchChanges: async () => ({ kind: 'page', changes, nextCursor: '4', hasMore: false }),
        fetchSnapshot: async id => { fetched.push(id); return { ...snapshot, id, metadataVersion: 2 }; },
        applySnapshot: async value => { applied.push(value.id); }, deleteSession: id => { deleted.push(id); },
    });
    expect(fetched).toEqual(['s']);
    expect(applied).toEqual(['s']);
    expect((await history.readReconciliation()).cursor).toBe('4');
    expect(await history.listSnapshotRefreshIds()).toEqual([]);
    expect(await history.readSnapshot('unseen-0')).toBeNull();
    expect(await history.readChange('unseen-0')).toBeNull();
    expect(await history.readSnapshot('gone')).toBeNull();
    expect(deleted).toEqual(['gone']);
});
