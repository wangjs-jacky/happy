import { ApiMessageSchema, ApiSessionSnapshotSchema, type ApiMessage, type ApiSessionSnapshot } from './apiTypes';
import type { SessionChange } from './apiSessionChanges';

export const HISTORY_LATEST_BOUNDARY = 2147483647;
export type ReadingState = { version: 1; anchorId: string; anchorSeq: number; offset: number; expandedGroupIds: string[]; followLatest?: boolean };
export type HistoryPage = { direction: 'older' | 'newer'; boundary: number; messages: ApiMessage[]; hasMore: boolean };
export type HistoryWindow = { messages: ApiMessage[]; oldestSeq: number | null; newestSeq: number | null;
    hasMoreOlder: boolean; hasMoreNewer: boolean; isAtLatest: boolean };
type Interval = [number, number];
type SessionRecord = { scope: string; id: string; snapshot?: ApiSessionSnapshot; intervals: Interval[];
    tailSeq?: number; change?: SessionChange; deleted?: boolean; reading?: ReadingState };
type AccountRecord = { scope: string; epoch: number; cursor: string | null; imported?: boolean };
type Invalidation = { scope: string; sessionId?: string; kind: 'session-deleted' | 'scope-cleared' | 'account-closed' };
const listeners = new Set<(event: Invalidation) => void>();
const handles = new Set<LocalHistory>();
export function subscribeLocalHistoryInvalidation(listener: (event: Invalidation) => void): () => void {
    listeners.add(listener); return () => { listeners.delete(listener); };
}
function emit(event: Invalidation) { for (const listener of listeners) listener(event); }
export async function clearLocalHistoryCaches(): Promise<void> {
    await Promise.all([...handles].map(handle => handle.clear()));
}
function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function complete(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); });
}
function mergeIntervals(ranges: Interval[]): Interval[] {
    const merged: Interval[] = [];
    for (const range of ranges.sort((a, b) => a[0] - b[0])) {
        if (range[1] < range[0]) continue;
        const previous = merged[merged.length - 1];
        if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]);
        else merged.push([...range]);
    }
    return merged;
}
function range(scope: string, id: string, lower = 0, upper = HISTORY_LATEST_BOUNDARY) {
    return IDBKeyRange.bound([scope, id, lower], [scope, id, upper]);
}
function sessionRange(scope: string) { return IDBKeyRange.bound([scope, ''], [scope, '\uffff']); }

/** Per-record wire archive. All write promises resolve only after transaction commit.
 * Failures are cache misses; transactions never expose coverage without its bytes. */
export class LocalHistory {
    private closed = false;
    private deleted = new Set<string>();
    constructor(private db: IDBDatabase, readonly scope: string, private epoch: number) { handles.add(this); }
    captureSessionFence(sessionId: string) { return { history: this, sessionId, epoch: this.epoch }; }
    isFenceCurrent(fence: ReturnType<LocalHistory['captureSessionFence']>) {
        return fence.history === this && !this.closed && fence.epoch === this.epoch && !this.deleted.has(fence.sessionId);
    }
    close() { this.closed = true; handles.delete(this); this.db.close(); emit({ scope: this.scope, kind: 'account-closed' }); }

    private async transaction<T>(mode: IDBTransactionMode, fallback: T,
        action: (tx: IDBTransaction, account: AccountRecord) => Promise<T>): Promise<T> {
        if (this.closed) return fallback;
        let tx: IDBTransaction | undefined;
        let done: Promise<void> | undefined;
        try {
            tx = this.db.transaction(['accounts', 'sessions', 'messages'], mode);
            done = complete(tx);
            void done.catch(() => undefined);
            const account = await request<AccountRecord>(tx.objectStore('accounts').get(this.scope));
            if (!account || account.epoch !== this.epoch || this.closed) { tx.abort(); return fallback; }
            const result = await action(tx, account);
            await done;
            return result;
        } catch {
            try { tx?.abort(); } catch { /* already completed */ }
            await done?.catch(() => undefined);
            return fallback;
        }
    }
    private async session(tx: IDBTransaction, id: string): Promise<SessionRecord> {
        return await request<SessionRecord>(tx.objectStore('sessions').get([this.scope, id]))
            ?? { scope: this.scope, id, intervals: [] };
    }
    readSnapshot(id: string): Promise<ApiSessionSnapshot | null> {
        return this.transaction('readonly', null, async tx => {
            const record = await this.session(tx, id);
            const parsed = ApiSessionSnapshotSchema.safeParse(record.snapshot);
            return !record.deleted && parsed.success ? parsed.data : null;
        });
    }
    listSnapshots(): Promise<ApiSessionSnapshot[]> {
        return this.transaction('readonly', [], async tx => {
            const records = await request<SessionRecord[]>(tx.objectStore('sessions').getAll(sessionRange(this.scope)));
            return records.flatMap(record => {
                const parsed = ApiSessionSnapshotSchema.safeParse(record.snapshot);
                return !record.deleted && parsed.success ? [parsed.data] : [];
            });
        });
    }
    listSnapshotRefreshIds(): Promise<string[]> {
        return this.transaction('readonly', [], async tx => {
            const records = await request<SessionRecord[]>(tx.objectStore('sessions').getAll(sessionRange(this.scope)));
            return records.flatMap(record => {
                if (record.deleted || record.change?.deleted) return [];
                const snapshot = ApiSessionSnapshotSchema.safeParse(record.snapshot);
                const change = record.change;
                const pending = change ? !snapshot.success
                    || change.metadataVersion > snapshot.data.metadataVersion
                    || change.agentStateVersion > snapshot.data.agentStateVersion
                    : record.snapshot !== undefined;
                return pending ? [record.id] : [];
            });
        });
    }
    writeSnapshots(snapshots: ApiSessionSnapshot[]): Promise<boolean> {
        return this.transaction('readwrite', false, async tx => {
            for (const snapshot of snapshots) {
                const record = await this.session(tx, snapshot.id);
                if (record.deleted || this.deleted.has(snapshot.id)) continue;
                const previous = record.snapshot;
                record.snapshot = !previous ? snapshot : {
                    ...(previous.updatedAt > snapshot.updatedAt ? previous : snapshot),
                    seq: Math.max(previous.seq, snapshot.seq),
                    ...(previous.metadataVersion > snapshot.metadataVersion ? { metadata: previous.metadata, metadataVersion: previous.metadataVersion } : {}),
                    ...(previous.agentStateVersion > snapshot.agentStateVersion ? { agentState: previous.agentState, agentStateVersion: previous.agentStateVersion } : {}),
                };
                tx.objectStore('sessions').put(record);
            }
            return true;
        });
    }
    commitPage(id: string, page: HistoryPage): Promise<boolean> {
        return this.transaction('readwrite', false, async tx => {
            const record = await this.session(tx, id);
            if (record.deleted || this.deleted.has(id)) return false;
            const seqs = page.messages.map(message => message.seq);
            const min = Math.min(...seqs, page.boundary);
            const max = Math.max(...seqs, page.direction === 'newer' ? page.boundary : 0);
            const isLatest = page.direction === 'older' && page.boundary === HISTORY_LATEST_BOUNDARY;
            const lower = page.direction === 'newer' ? page.boundary + 1 : page.hasMore ? min : 0;
            const upper = page.direction === 'newer' || isLatest ? max : page.boundary - 1;
            record.intervals = mergeIntervals([...record.intervals, [lower, upper]]);
            if (isLatest || (page.direction === 'newer' && !page.hasMore)) record.tailSeq = Math.max(record.tailSeq ?? 0, max);
            for (const message of page.messages) tx.objectStore('messages').put({ scope: this.scope, id, seq: message.seq, message });
            tx.objectStore('sessions').put(record);
            return true;
        });
    }
    appendMessages(id: string, messages: ApiMessage[]): Promise<boolean> {
        return this.transaction('readwrite', false, async tx => {
            const record = await this.session(tx, id);
            if (record.deleted || this.deleted.has(id)) return false;
            for (const message of [...messages].sort((a, b) => a.seq - b.seq)) {
                tx.objectStore('messages').put({ scope: this.scope, id, seq: message.seq, message });
                // A received adjacent append can extend confirmed coverage; an isolated
                // socket record must never certify the interval preceding it.
                record.intervals = mergeIntervals([...record.intervals, [message.seq, message.seq]]);
                if (record.tailSeq !== undefined && message.seq === record.tailSeq + 1) record.tailSeq = message.seq;
            }
            tx.objectStore('sessions').put(record); return true;
        });
    }
    invalidateMessages(id: string): Promise<boolean> {
        return this.transaction('readwrite', false, async tx => {
            const record = await this.session(tx, id);
            record.intervals = []; delete record.tailSeq;
            tx.objectStore('messages').delete(range(this.scope, id));
            tx.objectStore('sessions').put(record); return true;
        });
    }
    private async messages(tx: IDBTransaction, id: string, low: number, high: number,
        direction: IDBCursorDirection, limit: number): Promise<ApiMessage[]> {
        if (low > high) return [];
        const values: ApiMessage[] = [];
        await new Promise<void>((resolve, reject) => {
            const req = tx.objectStore('messages').openCursor(range(this.scope, id, low, high), direction);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor || values.length >= limit) { resolve(); return; }
                const parsed = ApiMessageSchema.safeParse(cursor.value.message);
                if (!parsed.success) { reject(new Error('corrupt-history-record')); return; }
                values.push(parsed.data); cursor.continue();
            };
        });
        return direction === 'prev' ? values.reverse() : values;
    }
    readWindow(id: string, options: { anchorSeq?: number; limit?: number } = {}): Promise<HistoryWindow | null> {
        return this.transaction('readonly', null, async tx => {
            const record = await this.session(tx, id);
            if (record.deleted) return null;
            const anchor = options.anchorSeq ?? record.tailSeq;
            if (anchor === undefined) return null;
            const interval = record.intervals.find(([lo, hi]) => lo <= anchor && hi >= anchor);
            if (!interval) return null;
            const limit = Math.max(1, Math.min(options.limit ?? 100, 300));
            let messages: ApiMessage[];
            if (options.anchorSeq === undefined) messages = await this.messages(tx, id, interval[0], anchor, 'prev', limit);
            else {
                const older = await this.messages(tx, id, interval[0], anchor, 'prev', Math.ceil(limit / 2));
                const newer = await this.messages(tx, id, anchor + 1, interval[1], 'next', limit - older.length);
                messages = [...older, ...newer];
            }
            const oldest = messages[0]?.seq ?? null;
            const newest = messages[messages.length - 1]?.seq ?? null;
            const atLatest = record.tailSeq !== undefined && (newest ?? 0) === record.tailSeq
                && (record.change?.lastMessageSeq ?? 0) <= record.tailSeq;
            return { messages, oldestSeq: oldest, newestSeq: newest,
                hasMoreOlder: interval[0] > 0 || (oldest !== null && (await this.messages(tx, id, interval[0], oldest - 1, 'prev', 1)).length > 0),
                hasMoreNewer: !atLatest, isAtLatest: atLatest };
        });
    }
    private readPage(id: string, boundary: number, limit: number, direction: 'older' | 'newer'): Promise<HistoryPage | null> {
        return this.transaction('readonly', null, async tx => {
            const record = await this.session(tx, id);
            if (record.deleted) return null;
            const interval = record.intervals.find(([lo, hi]) => direction === 'older'
                ? lo < boundary && hi >= boundary - 1 : lo <= boundary + 1 && hi > boundary);
            if (!interval) return null;
            const messages = await this.messages(tx, id, direction === 'older' ? interval[0] : boundary + 1,
                direction === 'older' ? boundary - 1 : interval[1], direction === 'older' ? 'prev' : 'next', limit + 1);
            const overflow = messages.length > limit;
            const selected = direction === 'older' ? messages.slice(-limit) : messages.slice(0, limit);
            const completeEdge = direction === 'older' ? interval[0] === 0
                : record.tailSeq !== undefined && interval[1] >= record.tailSeq && (record.change?.lastMessageSeq ?? 0) <= record.tailSeq;
            // A partial connected island cannot answer a server page: do not claim
            // that absent cached records beyond its edge are an empty result.
            if (selected.length === 0 && !completeEdge) return null;
            return { direction, boundary, messages: selected, hasMore: overflow || !completeEdge };
        });
    }
    readOlderPage(id: string, boundary: number, limit = 100) { return this.readPage(id, boundary, limit, 'older'); }
    readNewerPage(id: string, boundary: number, limit = 100) { return this.readPage(id, boundary, limit, 'newer'); }
    readReadingState(id: string): Promise<ReadingState | null> {
        return this.transaction('readonly', null, async tx => {
            const record = await this.session(tx, id); return record.deleted ? null : record.reading ?? null;
        });
    }
    writeReadingState(id: string, state: ReadingState): Promise<boolean> {
        return this.transaction('readwrite', false, async tx => {
            const record = await this.session(tx, id);
            if (record.deleted || this.deleted.has(id)) return false;
            record.reading = state; tx.objectStore('sessions').put(record); return true;
        });
    }
    readChange(id: string): Promise<SessionChange | null> {
        return this.transaction('readonly', null, async tx => (await this.session(tx, id)).change ?? null);
    }
    readReconciliation(): Promise<{ cursor: string | null; imported?: boolean }> {
        return this.transaction('readonly', { cursor: null, imported: undefined }, async (_tx, account) => ({ cursor: account.cursor, imported: account.imported }));
    }
    commitReconciliation(page: { changes: SessionChange[]; nextCursor: string }): Promise<boolean> {
        return this.transaction('readwrite', false, async (tx, account) => {
            for (const change of page.changes) {
                const record = await this.session(tx, change.sessionId);
                if (record.change && BigInt(record.change.revision) >= BigInt(change.revision)) continue;
                record.change = change;
                if (change.deleted) {
                    record.deleted = true; delete record.snapshot; delete record.reading; record.intervals = [];
                    tx.objectStore('messages').delete(range(this.scope, change.sessionId));
                }
                tx.objectStore('sessions').put(record);
            }
            tx.objectStore('accounts').put({ ...account, cursor: page.nextCursor }); return true;
        });
    }
    resetCursor(): Promise<boolean> {
        return this.transaction('readwrite', false, async (tx, account) => {
            tx.objectStore('accounts').put({ ...account, cursor: null }); return true;
        });
    }
    async importLegacyWarmCache(cache: { snapshots: ApiSessionSnapshot[]; latestPages: Record<string, { messages: ApiMessage[]; hasMore: boolean }> }): Promise<void> {
        if ((await this.readReconciliation()).imported) return;
        // Existing archive snapshots/pages win. Legacy data is only a one-time seed.
        for (const snapshot of cache.snapshots) if (!await this.readSnapshot(snapshot.id)) await this.writeSnapshots([snapshot]);
        for (const [id, page] of Object.entries(cache.latestPages)) if (!await this.readWindow(id)) {
            await this.commitPage(id, { ...page, direction: 'older', boundary: HISTORY_LATEST_BOUNDARY });
        }
        await this.transaction('readwrite', false, async (tx, account) => {
            tx.objectStore('accounts').put({ ...account, imported: true }); return true;
        });
    }
    deleteSession(id: string): Promise<boolean> {
        this.deleted.add(id); emit({ scope: this.scope, sessionId: id, kind: 'session-deleted' });
        return this.transaction('readwrite', false, async tx => {
            const record = await this.session(tx, id);
            tx.objectStore('sessions').put({ scope: this.scope, id, deleted: true, change: record.change, intervals: [] });
            tx.objectStore('messages').delete(range(this.scope, id)); return true;
        });
    }
    async clear(): Promise<void> {
        if (this.closed) return;
        // Fence immediately, before the clearing transaction is scheduled.
        this.closed = true; emit({ scope: this.scope, kind: 'scope-cleared' });
        try {
            const tx = this.db.transaction(['accounts', 'sessions', 'messages'], 'readwrite');
            const done = complete(tx);
            void done.catch(() => undefined);
            const account = await request<AccountRecord>(tx.objectStore('accounts').get(this.scope));
            tx.objectStore('accounts').put({ scope: this.scope, epoch: (account?.epoch ?? this.epoch) + 1, cursor: null });
            tx.objectStore('sessions').delete(sessionRange(this.scope));
            tx.objectStore('messages').delete(IDBKeyRange.bound([this.scope, '', 0], [this.scope, '\uffff', HISTORY_LATEST_BOUNDARY]));
            await done;
        } catch { /* optional persistent cache */ }
        handles.delete(this); this.db.close();
    }
}

/** Native has no IndexedDB: callers keep their existing MMKV warm/network path. */
export async function openLocalHistory(scope: string): Promise<LocalHistory | null> {
    try {
        if (typeof indexedDB === 'undefined') return null;
        const opening = indexedDB.open('paws-local-history-v1', 1);
        opening.onupgradeneeded = () => {
            const db = opening.result;
            db.createObjectStore('accounts', { keyPath: 'scope' });
            db.createObjectStore('sessions', { keyPath: ['scope', 'id'] });
            db.createObjectStore('messages', { keyPath: ['scope', 'id', 'seq'] });
        };
        const db = await request(opening);
        db.onversionchange = () => db.close();
        const tx = db.transaction('accounts', 'readwrite');
        const done = complete(tx);
        void done.catch(() => undefined);
        let account = await request<AccountRecord>(tx.objectStore('accounts').get(scope));
        if (!account) { account = { scope, epoch: 0, cursor: null }; tx.objectStore('accounts').put(account); }
        await done;
        return new LocalHistory(db, scope, account.epoch);
    } catch { return null; }
}
