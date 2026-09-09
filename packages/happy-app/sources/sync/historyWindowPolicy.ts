import type { HistoryWindow } from './localHistoryStore';
import type { ApiMessage } from './apiTypes';

export const WEB_HISTORY_MAX_MESSAGES = 500;
export const WEB_HISTORY_HARD_MAX_MESSAGES = 5000;
export type HistoryViewportRange = { firstSeq: number; lastSeq: number };
export type HistoryViewportReader = () => HistoryViewportRange | undefined;
export const WEB_HISTORY_MAX_BYTES = 8 * 1024 * 1024;

// Approximate encrypted wire storage; decrypted reducer/DOM expansion is separate.
const wireBytes = (message: ApiMessage) => 128 + 2 * (message.content.c.length + message.id.length + (message.localId?.length ?? 0));
export function historyWindowBytes(window: HistoryWindow): number {
    return window.messages.reduce((sum, message) => sum + wireBytes(message), 0);
}

export function boundHistoryWindow(window: HistoryWindow, options: {
    anchorSeq?: number; direction?: 'older' | 'newer'; compact?: boolean; protectedRange?: HistoryViewportRange;
} = {}): HistoryWindow {
    let maxCount = options.compact ? 400 : WEB_HISTORY_MAX_MESSAGES;
    const maxBytes = options.compact ? 6 * 1024 * 1024 : WEB_HISTORY_MAX_BYTES;
    const rows = window.messages;
    if (!rows.length) return window;
    const sizes = rows.map(wireBytes);
    if (rows.length <= maxCount && sizes.reduce((a, b) => a + b, 0) <= maxBytes) return window;
    const anchor = options.anchorSeq === undefined ? -1 : rows.findIndex(row => row.seq === options.anchorSeq);
    const protectedFirst = options.protectedRange ? rows.findIndex(row => row.seq >= options.protectedRange!.firstSeq) : -1;
    const protectedLast = options.protectedRange ? rows.findLastIndex(row => row.seq <= options.protectedRange!.lastSeq) : -1;
    let protectedStart = -1;
    let protectedEnd = -1;
    if (!options.compact && protectedFirst >= 0 && protectedLast >= protectedFirst && anchor >= 0) {
        // Raw event density is unrelated to visible height: hundreds of tool
        // events may fold into one row. Leave room for the requested page while
        // protecting the current viewport, subject to a separate hard budget.
        const first = Math.min(protectedFirst, anchor);
        const last = Math.max(protectedLast, anchor);
        let bytes = sizes.slice(first, last + 1).reduce((a, b) => a + b, 0);
        if (last - first + 1 > WEB_HISTORY_HARD_MAX_MESSAGES || bytes > maxBytes) {
            throw new Error('history-window-capacity');
        }
        protectedStart = first;
        protectedEnd = last + 1;
        // Consume as much of the requested page as fits; a partial page must
        // not make us abandon the viewport or silently return the same cursor.
        for (let added = 0; added < 100 && protectedEnd - protectedStart < WEB_HISTORY_HARD_MAX_MESSAGES; added++) {
            const index = options.direction === 'older' ? protectedStart - 1 : protectedEnd;
            if (index < 0 || index >= rows.length || bytes + sizes[index] > maxBytes) break;
            bytes += sizes[index];
            if (options.direction === 'older') protectedStart--; else protectedEnd++;
        }
        if ((options.direction === 'newer' && anchor + 1 < rows.length && protectedEnd <= anchor + 1)
            || (options.direction === 'older' && anchor > 0 && protectedStart >= anchor)) {
            throw new Error('history-window-capacity');
        }
        maxCount = Math.max(maxCount, protectedEnd - protectedStart);
    }
    let start = anchor >= 0 ? anchor : options.direction === 'older' ? 0 : rows.length - 1;
    const neighbor = anchor + (options.direction === 'older' ? -1 : 1);
    if (anchor >= 0 && options.direction && neighbor >= 0 && neighbor < rows.length
        && sizes[anchor] + sizes[neighbor] > maxBytes) {
        // Explicit navigation must be able to cross an oversized row. When
        // both edges cannot coexist, show the requested neighbor on its own.
        start = neighbor;
    }
    let end = start + 1;
    if (protectedStart >= 0) { start = protectedStart; end = protectedEnd; }
    let bytes = sizes.slice(start, end).reduce((a, b) => a + b, 0);
    // Keep a contiguous interval: never skip a large neighbor and hide a gap.
    // One oversized anchor remains readable even if it alone exceeds the budget.
    while (end - start < maxCount) {
        const before = start > 0 && bytes + sizes[start - 1] <= maxBytes;
        const after = end < rows.length && bytes + sizes[end] <= maxBytes;
        if (!before && !after) break;
        const preferBefore = anchor >= 0 ? anchor - start <= end - anchor : options.direction !== 'newer';
        if (before && (preferBefore || !after)) bytes += sizes[--start];
        else bytes += sizes[end++];
    }
    const messages = rows.slice(start, end);
    return { ...window, messages, oldestSeq: messages[0].seq, newestSeq: messages.at(-1)!.seq,
        hasMoreOlder: window.hasMoreOlder || start > 0,
        hasMoreNewer: window.hasMoreNewer || end < rows.length,
        isAtLatest: window.isAtLatest && end === rows.length };
}
