import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionHistoryPrefetch } from './sessionHistoryPrefetch';
import type { ApiMessage } from './apiTypes';

const page = (seqs: number[], hasMore = true) => ({ hasMore, messages: seqs.map(seq => ({
    id: `m${seq}`, seq, localId: null, createdAt: seq, updatedAt: seq,
    content: { t: 'encrypted', c: 'ciphertext' },
})) as ApiMessage[] });

describe('background history archive', () => {
    let worker: SessionHistoryPrefetch;
    beforeEach(() => { vi.useFakeTimers(); worker = new SessionHistoryPrefetch(); });
    afterEach(() => { worker.stop(); vi.useRealTimers(); });
    function harness() {
        const disk = new Map<number, ReturnType<typeof page>>();
        const requests: number[] = [];
        let active = true;
        const task = {
            key: {}, sessionId: 'a', beforeSeq: 301,
            isCurrent: () => active, canRun: () => true,
            read: async (boundary: number) => disk.get(boundary) ?? null,
            fetch: async (boundary: number, _signal: AbortSignal) => {
                requests.push(boundary);
                return boundary === 301 ? page([201, 250, 300]) : page([1, 100, 200], false);
            },
            write: async (boundary: number, value: ReturnType<typeof page>) => { disk.set(boundary, value); return true; },
        };
        return { task, disk, requests, deactivate: () => { active = false; } };
    }
    it('downloads all pages after yielding and reuses saved pages on revisit', async () => {
        const h = harness(); worker.start(h.task);
        expect(h.requests).toEqual([]);
        await vi.runAllTimersAsync();
        expect(h.requests).toEqual([301, 201]);
        expect(h.disk.get(201)).toEqual(page([1, 100, 200], false));
        worker.start({ ...h.task, key: {} });
        await vi.runAllTimersAsync();
        expect(h.requests).toEqual([301, 201]);
    });
    it('pauses behind foreground work and resumes without losing progress', async () => {
        const h = harness(); let busy = true; h.task.canRun = () => !busy;
        worker.start(h.task); await vi.advanceTimersByTimeAsync(4000);
        expect(h.requests).toEqual([]);
        busy = false; await vi.runAllTimersAsync();
        expect(h.requests).toEqual([301, 201]);
    });
    it('cancels a route transfer and refuses its late cache write', async () => {
        const h = harness(); let signal: AbortSignal | undefined;
        let finish!: (value: ReturnType<typeof page>) => void;
        h.task.fetch = async (_boundary, value) => { signal = value; return new Promise(resolve => { finish = resolve; }); };
        worker.start(h.task); await vi.advanceTimersByTimeAsync(1000);
        worker.stop(); expect(signal?.aborted).toBe(true);
        finish(page([201])); await vi.runAllTimersAsync();
        expect(h.disk.size).toBe(0);
    });
    it('does not cache after the account or session owner becomes invalid', async () => {
        const h = harness(); h.task.fetch = async () => { h.deactivate(); return page([201]); };
        worker.start(h.task); await vi.runAllTimersAsync();
        expect(h.disk.size).toBe(0);
    });
    it('stops on full storage instead of downloading uncachable history', async () => {
        const h = harness(); h.task.write = async () => false;
        worker.start(h.task); await vi.runAllTimersAsync();
        expect(h.requests).toEqual([301]);
    });
    it.each([page([], true), page([301]), page([302])])('bounds retries for non-progressing pages %#', async invalid => {
        const h = harness(); h.task.fetch = async boundary => { h.requests.push(boundary); return invalid; };
        worker.start(h.task); await vi.runAllTimersAsync();
        expect(h.disk.size).toBe(0); expect(h.requests.length).toBeGreaterThan(0);
        expect(h.requests.length).toBeLessThanOrEqual(3);
    });
    it('lets a foreground reader await the same page without starting another transfer', async () => {
        const h = harness(); let finish!: (value: ReturnType<typeof page>) => void;
        h.task.fetch = async boundary => { h.requests.push(boundary); return new Promise(resolve => { finish = resolve; }); };
        worker.start(h.task); await vi.advanceTimersByTimeAsync(1000);
        const waiting = worker.waitForPage('a', 301);
        finish(page([1, 300], false)); await waiting;
        expect(h.disk.get(301)).toEqual(page([1, 300], false));
        expect(h.requests).toEqual([301]);
    });
});
