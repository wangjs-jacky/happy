import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiMessage, ApiSessionSnapshot } from './apiTypes';
import {
    appendSessionWarmMessages,
    clearSessionWarmCache,
    loadSessionWarmCache,
    removeSessionFromWarmCache,
    saveSessionWarmLatestPage,
    saveSessionWarmSnapshots,
} from './sessionWarmCache';

function snapshot(id: string, updatedAt: number): ApiSessionSnapshot {
    return {
        id, seq: updatedAt, metadata: `cipher-${id}`, metadataVersion: updatedAt,
        agentState: null, agentStateVersion: 0, dataEncryptionKey: `key-${id}`,
        active: true, activeAt: updatedAt, createdAt: 1, updatedAt,
    };
}

function message(seq: number): ApiMessage {
    return {
        id: `message-${seq}`, seq, localId: null,
        content: { t: 'encrypted', c: `cipher-${seq}` },
        createdAt: seq, updatedAt: seq,
    };
}

describe('session warm cache', () => {
    beforeEach(() => clearSessionWarmCache());

    it('restores only the matching account encrypted snapshots and latest pages', () => {
        saveSessionWarmSnapshots('account-a', [snapshot('one', 10)]);
        saveSessionWarmLatestPage('account-a', 'one', { messages: [message(10)], hasMore: true });

        expect(loadSessionWarmCache('account-a')).toMatchObject({
            snapshots: [{ id: 'one', metadata: 'cipher-one' }],
            latestPages: { one: { messages: [{ id: 'message-10' }], hasMore: true } },
        });
        expect(loadSessionWarmCache('account-b')).toEqual({ snapshots: [], latestPages: {} });
    });

    it('keeps only the three most recently cached message pages', () => {
        for (let index = 1; index <= 4; index += 1) {
            saveSessionWarmLatestPage('account-a', `session-${index}`, {
                messages: [message(index)], hasMore: false,
            });
        }

        expect(Object.keys(loadSessionWarmCache('account-a').latestPages)).toEqual([
            'session-2', 'session-3', 'session-4',
        ]);
    });

    it('does not replace a newer snapshot with a lower sequence', () => {
        saveSessionWarmSnapshots('account-a', [snapshot('one', 20)]);
        saveSessionWarmSnapshots('account-a', [{ ...snapshot('one', 30), seq: 10 }]);

        expect(loadSessionWarmCache('account-a').snapshots[0]).toMatchObject({
            id: 'one', seq: 20, metadata: 'cipher-one',
        });
    });

    it('advances the encrypted latest window without persisting decrypted content', () => {
        saveSessionWarmLatestPage('account-a', 'one', { messages: [message(10)], hasMore: true });
        appendSessionWarmMessages('account-a', 'one', [message(11), message(12)]);

        expect(loadSessionWarmCache('account-a').latestPages.one).toMatchObject({
            messages: [{ seq: 10 }, { seq: 11 }, { seq: 12 }],
            hasMore: true,
        });
    });

    it('retains history pagination after repeated increments trim the latest window', () => {
        saveSessionWarmLatestPage('a', 'one', { messages: [message(1)], hasMore: false });
        appendSessionWarmMessages('a', 'one', Array.from({ length: 100 }, (_, i) => message(i + 2)));
        appendSessionWarmMessages('a', 'one', [message(102)]);
        const page = loadSessionWarmCache('a').latestPages.one;
        expect(page.messages).toHaveLength(100);
        expect(page.messages[0].seq).toBe(3);
        expect(page.messages.at(-1)?.seq).toBe(102);
        expect(page.hasMore).toBe(true);
    });

    it('clears the previous account on account transition and clears all data on logout', () => {
        saveSessionWarmSnapshots('a', [snapshot('one', 1)]);
        loadSessionWarmCache('b');
        expect(loadSessionWarmCache('a').snapshots).toEqual([]);
        saveSessionWarmLatestPage('b', 'two', { messages: [message(1)], hasMore: false });
        clearSessionWarmCache();
        expect(loadSessionWarmCache('b').latestPages).toEqual({});
    });

    it('touches a revisited page even when incremental sync returns no messages', () => {
        for (const id of ['a', 'b', 'c']) {
            saveSessionWarmLatestPage('account', id, { messages: [message(1)], hasMore: false });
        }
        appendSessionWarmMessages('account', 'a', []);
        saveSessionWarmLatestPage('account', 'd', { messages: [message(1)], hasMore: false });
        expect(Object.keys(loadSessionWarmCache('account').latestPages).sort()).toEqual(['a', 'c', 'd']);
    });

    it('removes both snapshot and latest page when a session is deleted', () => {
        saveSessionWarmSnapshots('a', [snapshot('one', 1)]);
        saveSessionWarmLatestPage('a', 'one', { messages: [message(1)], hasMore: false });

        removeSessionFromWarmCache('a', 'one');

        expect(loadSessionWarmCache('a')).toEqual({ snapshots: [], latestPages: {} });
    });
});
