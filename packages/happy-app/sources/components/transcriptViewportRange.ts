import type { Message } from '@/sync/typesMessage';
import type { HistoryViewportRange } from '@/sync/historyWindowPolicy';

/** Protect the loaded turns that determine visible groups, including the final
 * response and raw events that do not have their own rendered message. Input is
 * newest-first, with superseded user prompts already removed by the caller. */
export function transcriptViewportRange(messages: Message[], visible: Message[], wireSeq: (id: string) => number | null,
    bounds: { oldestSeq?: number | null; newestSeq?: number | null } = {}): HistoryViewportRange | undefined {
    const visibleSeqs = new Set(visible.map(message => wireSeq(message.id)).filter((seq): seq is number => seq !== null));
    if (!visibleSeqs.size) return undefined;
    let firstSeq = Math.min(...visibleSeqs);
    let lastSeq = Math.max(...visibleSeqs);
    let upper = bounds.newestSeq ?? null;
    let turnSeqs: number[] = [];
    let containsVisible = false;
    const flush = (lower?: number | null) => {
        if (containsVisible && turnSeqs.length) {
            firstSeq = Math.min(firstSeq, lower ?? Math.min(...turnSeqs));
            lastSeq = Math.max(lastSeq, upper ?? Math.max(...turnSeqs));
        }
        turnSeqs = [];
        containsVisible = false;
    };
    for (const message of messages) {
        const seq = wireSeq(message.id);
        if (seq !== null) {
            turnSeqs.push(seq);
            containsVisible ||= visibleSeqs.has(seq);
        }
        // The prompt belongs to the assistant messages immediately before it
        // in this newest-first array, matching transcript grouping.
        if (message.kind === 'user-text' && seq !== null) {
            flush(seq);
            upper = seq - 1;
        }
    }
    flush(bounds.oldestSeq);
    return { firstSeq, lastSeq };
}
