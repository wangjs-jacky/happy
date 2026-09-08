import { describe, expect, it } from 'vitest';
import { boundHistoryWindow, historyWindowBytes } from './historyWindowPolicy';
import type { HistoryWindow } from './localHistoryStore';

const fixture = (count: number, size = 0): HistoryWindow => ({
    messages: Array.from({ length: count }, (_, index) => ({ id: String(index + 1), seq: index + 1,
        content: { t: 'encrypted', c: 'x'.repeat(size) }, createdAt: index, updatedAt: index })),
    oldestSeq: 1, newestSeq: count, hasMoreOlder: false, hasMoreNewer: false, isAtLatest: true,
});

describe('Web history window policy', () => {
    it('retains a contiguous interval around the anchor with truthful reload flags', () => {
        const bounded = boundHistoryWindow(fixture(2000), { anchorSeq: 700 });
        expect(bounded.messages).toHaveLength(500);
        expect(bounded.messages.some(message => message.seq === 700)).toBe(true);
        expect(bounded.newestSeq! - bounded.oldestSeq!).toBe(499);
        expect(bounded).toMatchObject({ hasMoreOlder: true, hasMoreNewer: true, isAtLatest: false });
    });

    it('caps encrypted bytes even when the row count is small', () => {
        const bounded = boundHistoryWindow(fixture(20, 1024 * 1024));
        expect(bounded.messages).toHaveLength(3);
        expect(historyWindowBytes(bounded)).toBeLessThanOrEqual(8 * 1024 * 1024);
        expect(bounded).toMatchObject({ oldestSeq: 18, newestSeq: 20, hasMoreOlder: true, isAtLatest: true });
    });

    it('keeps one oversized reading anchor and does not hide either omitted side', () => {
        const window = fixture(3);
        window.messages[1].content.c = 'x'.repeat(5 * 1024 * 1024);
        const bounded = boundHistoryWindow(window, { anchorSeq: 2 });
        expect(bounded.messages).toEqual([window.messages[1]]);
        expect(bounded).toMatchObject({ oldestSeq: 2, newestSeq: 2, hasMoreOlder: true, hasMoreNewer: true, isAtLatest: false });
    });

    it('leaves slack after compaction so ordinary live appends need no replay', () => {
        const bounded = boundHistoryWindow(fixture(501), { compact: true });
        expect(bounded.messages).toHaveLength(400);
        expect(bounded).toMatchObject({ oldestSeq: 102, newestSeq: 501, isAtLatest: true });
    });

    it.each(['older', 'newer'] as const)('makes an oversized adjacent %s row reachable during explicit navigation', direction => {
        const window = fixture(3);
        const oversizedIndex = direction === 'older' ? 0 : 2;
        window.messages[oversizedIndex].content.c = 'x'.repeat(5 * 1024 * 1024);
        const bounded = boundHistoryWindow(window, { anchorSeq: 2, direction });
        expect(bounded.messages.map(message => message.id)).toEqual([String(oversizedIndex + 1)]);
        expect(bounded.messages[0]).toBe(window.messages[oversizedIndex]);
        expect(direction === 'older' ? bounded.hasMoreNewer : bounded.hasMoreOlder).toBe(true);
    });
});
