import { expect, it } from 'vitest';
import { boundHistoryWindow, historyWindowBytes } from './historyWindowPolicy';
import type { HistoryWindow } from './localHistoryStore';
const window = (count: number): HistoryWindow => ({ messages: Array.from({ length: count }, (_, i) => ({
    id: String(i + 1), seq: i + 1, createdAt: i, updatedAt: i, content: { t: 'encrypted', c: '' },
})), oldestSeq: 1, newestSeq: count, hasMoreOlder: false, hasMoreNewer: false, isAtLatest: true });
it('keeps the visible response when a sparse folded window preloads newer history', () => {
    const result = boundHistoryWindow(window(1000), { anchorSeq: 748, direction: 'newer',
        protectedRange: { firstSeq: 250, lastSeq: 748 } });
    expect(result.messages.some(row => row.seq === 461)).toBe(true);
    expect(result.oldestSeq).toBeLessThanOrEqual(250);
    expect(result.newestSeq).toBeGreaterThan(748);
    expect(result.messages.length).toBeLessThanOrEqual(5000);
});
it('does not grow ordinary dense windows whose visible rows fit inside the soft limit', () => {
    const result = boundHistoryWindow(window(1000), { anchorSeq: 748, direction: 'newer',
        protectedRange: { firstSeq: 680, lastSeq: 740 } });
    expect(result.messages).toHaveLength(500);
    expect(result.oldestSeq).toBeLessThanOrEqual(680);
    expect(result.newestSeq).toBeGreaterThan(748);
});
it('protects visible newer rows while loading older sparse history', () => {
    const result = boundHistoryWindow(window(1000), { anchorSeq: 500, direction: 'older',
        protectedRange: { firstSeq: 500, lastSeq: 991 } });
    expect(result.newestSeq).toBeGreaterThanOrEqual(991);
    expect(result.oldestSeq).toBeLessThan(500);
});
it('defers automatic navigation when the visible range fills the hard budget', () => {
    expect(() => boundHistoryWindow(window(5100), { anchorSeq: 5000, direction: 'newer',
        protectedRange: { firstSeq: 1, lastSeq: 5000 } })).toThrow('history-window-capacity');
    const continued = boundHistoryWindow(window(5100), { anchorSeq: 5000, direction: 'newer' });
    expect(continued.newestSeq).toBeGreaterThan(5000);
    expect(continued.messages.length).toBeLessThanOrEqual(5000);
    expect(historyWindowBytes(continued)).toBeLessThanOrEqual(8 * 1024 * 1024);
});
it('uses the remaining capacity instead of requiring room for an entire next page', () => {
    const result = boundHistoryWindow(window(5100), { anchorSeq: 4990, direction: 'newer',
        protectedRange: { firstSeq: 1, lastSeq: 4990 } });
    expect(result.oldestSeq).toBe(1);
    expect(result.newestSeq).toBe(5000);
});
