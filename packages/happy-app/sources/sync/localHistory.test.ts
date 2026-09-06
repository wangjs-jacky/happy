import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openLocalHistory } from './localHistoryStore';
import type { ApiMessage, ApiSessionSnapshot } from './apiTypes';

const message = (seq: number): ApiMessage => ({ id: `m${seq}`, seq, localId: null,
    content: { t: 'encrypted', c: `cipher${seq}` }, createdAt: seq, updatedAt: seq });
const snapshot = (id: string): ApiSessionSnapshot => ({ id, seq: 0, metadata: 'cipher',
    metadataVersion: 1, agentState: null, agentStateVersion: 0, dataEncryptionKey: null,
    active: false, activeAt: 0, createdAt: 0, updatedAt: 0 });
const change = (id: string, revision = '1', deleted = false) => ({ sessionId: id, revision,
    deleted, lastMessageSeq: 20, metadataVersion: 1, agentStateVersion: 0 });

describe('local encrypted history archive', () => {
    beforeEach(() => {
        globalThis.indexedDB = new IDBFactory();
        globalThis.IDBKeyRange = IDBKeyRange;
    });
    it('reopens over 150 snapshots and historical sparse pages without flattening gaps', async () => {
        const a = await openLocalHistory('https://server|a');
        await a!.writeSnapshots(Array.from({ length: 180 }, (_, i) => snapshot(`s${i}`)));
        await a!.commitPage('s0', { direction: 'older', boundary: 2147483647,
            messages: [message(90), message(100)], hasMore: true });
        await a!.commitPage('s0', { direction: 'older', boundary: 50,
            messages: [message(10), message(20)], hasMore: true });
        a!.close();
        const b = await openLocalHistory('https://server|a');
        expect((await b!.listSnapshots()).length).toBe(180);
        const old = await b!.readWindow('s0', { anchorSeq: 10 });
        expect(old?.messages.map(m => m.seq)).toEqual([10, 20]);
        expect(old?.isAtLatest).toBe(false);
        expect(await b!.readNewerPage('s0', 20, 100)).toBeNull();
        await b!.commitPage('s0', { direction: 'newer', boundary: 20,
            messages: [message(90), message(100)], hasMore: false });
        expect((await b!.readNewerPage('s0', 20, 100))?.messages.map(m => m.seq)).toEqual([90, 100]);
    });
    it('isolates scopes and fences pending writes after deletion and account clearing', async () => {
        const a = await openLocalHistory('server|a');
        const b = await openLocalHistory('server|b');
        const pending = a!.writeSnapshots([snapshot('s')]);
        await a!.deleteSession('s');
        await pending;
        await a!.writeSnapshots([snapshot('s')]);
        expect(await a!.readSnapshot('s')).toBeNull();
        await b!.writeSnapshots([snapshot('s')]);
        await a!.clear();
        await a!.writeSnapshots([snapshot('late')]);
        const reopened = await openLocalHistory('server|a');
        expect(await reopened!.listSnapshots()).toEqual([]);
        expect((await b!.readSnapshot('s'))?.id).toBe('s');
    });
    it('atomically commits invalidation targets, tombstones and the resume cursor', async () => {
        const a = await openLocalHistory('server|a');
        await a!.writeSnapshots([snapshot('s')]);
        await a!.commitReconciliation({ changes: [change('s', '2', true)], nextCursor: 'cursor2' });
        await a!.commitReconciliation({ changes: [change('s', '1')], nextCursor: 'cursor3' });
        a!.close();
        const b = await openLocalHistory('server|a');
        expect((await b!.readReconciliation()).cursor).toBe('cursor3');
        expect(await b!.readSnapshot('s')).toBeNull();
        expect((await b!.readChange('s'))?.deleted).toBe(true);
        await b!.resetCursor();
        expect((await b!.readReconciliation()).cursor).toBeNull();
        expect((await b!.readChange('s'))?.revision).toBe('2');
    });
    it('reopens durable snapshot work for unseen revisions and excludes resolved or deleted records', async () => {
        const a = (await openLocalHistory('pending'))!;
        await a.commitReconciliation({ changes: [change('unseen'), change('gone', '2', true)], nextCursor: '2' });
        a.close();
        const b = (await openLocalHistory('pending'))!;
        expect(await b.listSnapshotRefreshIds()).toEqual(['unseen']);
        await b.writeSnapshots([snapshot('unseen')]);
        expect(await b.listSnapshotRefreshIds()).toEqual([]);
    });
    it('does not publish partial coverage or cursor when a transaction cannot clone a record', async () => {
        const a = await openLocalHistory('server|a');
        const invalid = { ...message(1), extra: () => {} };
        expect(await a!.commitPage('s', { direction: 'older', boundary: 2147483647,
            messages: [invalid], hasMore: false })).toBe(false);
        expect(await a!.readWindow('s')).toBeNull();
        expect((await a!.readReconciliation()).cursor).toBeNull();
    });
    it('stores reading anchors and returns bounded windows in both directions', async () => {
        const a = await openLocalHistory('server|a');
        await a!.commitPage('s', { direction: 'older', boundary: 2147483647,
            messages: Array.from({ length: 400 }, (_, i) => message(i + 1)), hasMore: false });
        await a!.writeReadingState('s', { version: 1, anchorId: 'm150', anchorSeq: 150,
            offset: 22, expandedGroupIds: ['g1'] });
        const middle = await a!.readWindow('s', { anchorSeq: 150, limit: 100 });
        expect(middle?.messages.length).toBe(100);
        expect(middle?.messages.some(m => m.seq === 150)).toBe(true);
        expect(middle?.hasMoreOlder).toBe(true);
        expect(middle?.hasMoreNewer).toBe(true);
        expect((await a!.readReadingState('s'))?.expandedGroupIds).toEqual(['g1']);
        expect((await a!.readReadingState('s'))?.anchorBlock).toBeUndefined();
        await a!.writeReadingState('s', { version: 1, anchorId: 'm150', anchorSeq: 150,
            anchorBlock: 'text:1', offset: -200, expandedGroupIds: ['g1'] });
        a!.close();
        const reopened = (await openLocalHistory('server|a'))!;
        expect(await reopened.readReadingState('s')).toMatchObject({ anchorBlock: 'text:1', offset: -200 });
        expect((await reopened.readWindow('s'))?.isAtLatest).toBe(true);
        reopened.close();
    });
    it('degrades safely when IndexedDB is unavailable', async () => {
        const previous = globalThis.indexedDB;
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined, writable: true });
        expect(await openLocalHistory('server|a')).toBeNull();
        globalThis.indexedDB = previous;
    });
});
