import { describe, expect, it } from 'vitest';
import { applyLatestRange, applyOlderRange, type MessageRangeFrontier } from './sessionMessageFrontier';

const seqs = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
const latest: MessageRangeFrontier = { latestSeq: 250, olderBeforeSeq: 151, hasMoreOlder: true };

describe('latest message frontier', () => {
    it.each([
        { name: 'empty', current: undefined, page: null, more: false,
            want: { latestSeq: 0, olderBeforeSeq: null, hasMoreOlder: false } },
        { name: 'initial page', current: undefined, page: { minSeq: 151, maxSeq: 250 }, more: true,
            want: { latestSeq: 250, olderBeforeSeq: 151, hasMoreOlder: true } },
        { name: 'disconnected cached history', current: { latestSeq: 100, olderBeforeSeq: 1, hasMoreOlder: false }, page: { minSeq: 151, maxSeq: 250 }, more: true,
            want: { latestSeq: 250, olderBeforeSeq: 151, hasMoreOlder: true } },
        { name: 'adjacent page', current: { latestSeq: 150, olderBeforeSeq: 1, hasMoreOlder: false }, page: { minSeq: 151, maxSeq: 250 }, more: true,
            want: { latestSeq: 250, olderBeforeSeq: 1, hasMoreOlder: false } },
        { name: 'overlap keeps older progress', current: { latestSeq: 200, olderBeforeSeq: 51, hasMoreOlder: true }, page: { minSeq: 151, maxSeq: 250 }, more: true,
            want: { latestSeq: 250, olderBeforeSeq: 51, hasMoreOlder: true } },
        { name: 'stale latest cannot regress', current: latest, page: { minSeq: 1, maxSeq: 100 }, more: false,
            want: { latestSeq: 250, olderBeforeSeq: 151, hasMoreOlder: true } },
        { name: 'empty refresh preserves progress', current: latest, page: null, more: false,
            want: { latestSeq: 250, olderBeforeSeq: 151, hasMoreOlder: true } },
    ])('$name', ({ current, page, more, want }) => {
        expect(applyLatestRange(current, page, more)).toEqual(want);
    });
});

describe('older message frontier', () => {
    it.each([
        { name: 'empty exhausts history', page: null, more: false, cached: [],
            want: { latestSeq: 250, olderBeforeSeq: 151, hasMoreOlder: false } },
        { name: 'adjacent page', page: { minSeq: 51, maxSeq: 150 }, more: true, cached: [],
            want: { latestSeq: 250, olderBeforeSeq: 51, hasMoreOlder: true } },
        { name: 'overlap joins cached history', page: { minSeq: 51, maxSeq: 150 }, more: true, cached: seqs(1, 100),
            want: { latestSeq: 250, olderBeforeSeq: 1, hasMoreOlder: false } },
        { name: 'adjacent cache joins', page: { minSeq: 101, maxSeq: 150 }, more: true, cached: seqs(1, 100),
            want: { latestSeq: 250, olderBeforeSeq: 1, hasMoreOlder: false } },
        { name: 'cache gap remains reachable', page: { minSeq: 102, maxSeq: 150 }, more: true, cached: seqs(1, 100),
            want: { latestSeq: 250, olderBeforeSeq: 102, hasMoreOlder: true } },
        { name: 'single missing cached sequence stops walk', page: { minSeq: 101, maxSeq: 150 }, more: true, cached: [...seqs(1, 98), 100, 100],
            want: { latestSeq: 250, olderBeforeSeq: 100, hasMoreOlder: true } },
        { name: 'sparse response advances the observed request boundary', page: { minSeq: 50, maxSeq: 149 }, more: true, cached: seqs(1, 20),
            want: { latestSeq: 250, olderBeforeSeq: 50, hasMoreOlder: true } },
        { name: 'terminal sparse response exhausts history', page: { minSeq: 50, maxSeq: 149 }, more: false, cached: [],
            want: { latestSeq: 250, olderBeforeSeq: 50, hasMoreOlder: false } },
        { name: 'terminal server page', page: { minSeq: 51, maxSeq: 150 }, more: false, cached: [],
            want: { latestSeq: 250, olderBeforeSeq: 51, hasMoreOlder: false } },
    ])('$name', ({ page, more, cached, want }) => {
        expect(applyOlderRange(latest, page, more, cached)).toEqual(want);
    });
});
