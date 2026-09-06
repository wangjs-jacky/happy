import type { LocalHistory } from './localHistoryStore';
import type { fetchSessionChanges } from './apiSessionChanges';
import type { ApiSessionSnapshot } from './apiTypes';

/** Reconciliation persists invalidation targets with the cursor. Work interrupted
 * after that transaction is recovered from durable missing/stale snapshot work. */
export async function reconcileSessionHistory(history: LocalHistory, deps: {
    fetchChanges: (cursor?: string) => ReturnType<typeof fetchSessionChanges>;
    fetchSnapshot: (id: string) => Promise<ApiSessionSnapshot | null>;
    applySnapshot: (snapshot: ApiSessionSnapshot) => Promise<void>;
    deleteSession: (id: string) => void;
    isCurrent?: () => boolean;
}): Promise<'supported' | 'unsupported'> {
    const scopeFence = history.captureSessionFence('');
    const current = () => history.isFenceCurrent(scopeFence) && (deps.isCurrent?.() ?? true);
    let cursor = (await history.readReconciliation()).cursor ?? undefined;
    let reset = false;
    while (current()) {
        const page = await deps.fetchChanges(cursor);
        if (!current()) return 'supported';
        if (page.kind === 'unsupported') return 'unsupported';
        if (page.kind === 'reset') {
            if (reset) throw new Error('Repeated history cursor reset');
            if (!await history.resetCursor()) throw new Error('History cursor reset could not be persisted');
            cursor = undefined; reset = true; continue;
        }
        if (!await history.commitReconciliation(page)) throw new Error('History changes could not be persisted');
        if (!current()) return 'supported';
        for (const change of page.changes) if (change.deleted) deps.deleteSession(change.sessionId);
        if (!page.hasMore) break;
        if (page.nextCursor === cursor) throw new Error('History cursor pagination stalled');
        cursor = page.nextCursor;
    }
    const ids = await history.listSnapshotRefreshIds();
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (index < ids.length && current()) {
            const id = ids[index++];
            const fence = history.captureSessionFence(id);
            const owned = () => current() && history.isFenceCurrent(fence);
            const snapshot = await history.readSnapshot(id);
            const change = await history.readChange(id);
            if (!owned()) continue;
            // Pre-protocol cached identities lacking an index entry need a point
            // verification. Absence from an ordinary/initial page is never deletion.
            if (snapshot && change && !change.deleted && change.metadataVersion <= snapshot.metadataVersion
                && change.agentStateVersion <= snapshot.agentStateVersion) continue;
            if (change?.deleted) { deps.deleteSession(id); continue; }
            const fresh = await deps.fetchSnapshot(id);
            if (!owned()) continue;
            if (!fresh) { await history.deleteSession(id); if (current()) deps.deleteSession(id); }
            else { await history.writeSnapshots([fresh]); if (owned()) await deps.applySnapshot(fresh); }
        }
    }));
    return 'supported';
}
