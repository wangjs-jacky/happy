import { describe, expect, it, vi } from 'vitest';

import { createWebStartupTraceRuntime } from './sessionStartupTraceRuntime';

const TRACE_A = '00000000-0000-4000-8000-000000000001';
const TRACE_B = '00000000-0000-4000-8000-000000000002';

describe('browser startup trace runtime', () => {
    it('writes a processor-ready duration once for a bound session', () => {
        // Catches duplicate realtime ready events being recorded as separate milestones.
        const writer = vi.fn();
        const runtime = createWebStartupTraceRuntime(writer);
        const first = runtime.begin(TRACE_A, 100);

        expect(runtime.bindSession(first, 'session-a')).toBe(true);
        expect(runtime.markSessionStage('session-a', 'web.processor.ready_received', 350)).toBe(true);
        expect(writer).toHaveBeenCalledWith(expect.objectContaining({
            traceId: TRACE_A,
            stage: 'web.processor.ready_received',
            duration: 250,
        }));
        expect(runtime.markSessionStage('session-a', 'web.processor.ready_received', 400)).toBe(false);
    });

    it('does not let a stale same-session handle consume a newer binding', () => {
        // Catches cleanup from an older spawn deleting the currently active trace binding.
        const writer = vi.fn();
        const runtime = createWebStartupTraceRuntime(writer);
        const stale = runtime.begin(TRACE_A, 100);
        const current = runtime.begin(TRACE_B, 200);

        runtime.bindSession(stale, 'session-a');
        runtime.bindSession(current, 'session-a');
        runtime.finish(stale);

        expect(runtime.markSessionStage('session-a', 'web.processor.ready_received', 500)).toBe(true);
        expect(writer).toHaveBeenLastCalledWith(expect.objectContaining({ traceId: TRACE_B, duration: 300 }));
    });

    it('rejects a superseded handle that tries to reclaim a newer same-session binding', () => {
        // Catches an old spawn moving later lifecycle milestones back to its trace.
        const writer = vi.fn();
        const runtime = createWebStartupTraceRuntime(writer);
        const older = runtime.begin(TRACE_A, 100);
        const newer = runtime.begin(TRACE_B, 200);

        expect(runtime.bindSession(older, 'session-a')).toBe(true);
        expect(runtime.bindSession(newer, 'session-a')).toBe(true);
        expect(runtime.bindSession(older, 'session-a')).toBe(false);
        expect(runtime.markSessionStage('session-a', 'web.processor.ready_received', 500)).toBe(true);
        expect(writer).toHaveBeenLastCalledWith(expect.objectContaining({ traceId: TRACE_B, duration: 300 }));
    });

    it('cleans bindings on completion, cancellation, and explicit finish', () => {
        // Catches in-memory trace handles leaking into later sessions.
        const writer = vi.fn();
        const runtime = createWebStartupTraceRuntime(writer);
        const completed = runtime.begin(TRACE_A, 0);
        runtime.bindSession(completed, 'completed');
        runtime.markSessionStage('completed', 'web.turn.completed', 10);
        expect(runtime.markSessionStage('completed', 'web.first_agent_event_received', 20)).toBe(false);

        const cancelled = runtime.begin(TRACE_A, 0);
        runtime.bindSession(cancelled, 'cancelled');
        runtime.cancel(cancelled, 'spawn-failed');
        expect(runtime.markSessionStage('cancelled', 'web.processor.ready_received', 20)).toBe(false);

        const finished = runtime.begin(TRACE_A, 0);
        runtime.bindSession(finished, 'finished');
        runtime.finish(finished);
        expect(runtime.markSessionStage('finished', 'web.processor.ready_received', 20)).toBe(false);
    });

    it('expires an uncompleted binding after the bounded trace lifetime', () => {
        // Catches an abandoned startup trace retaining a session binding forever.
        vi.useFakeTimers();
        try {
            const runtime = createWebStartupTraceRuntime(vi.fn());
            const handle = runtime.begin(TRACE_A, 0);
            runtime.bindSession(handle, 'expired');
            vi.advanceTimersByTime(5 * 60_000);

            expect(runtime.markSessionStage('expired', 'web.processor.ready_received', 1)).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('rejects malformed handles and stages and contains writer failures', () => {
        // Catches malformed realtime input or observability outages affecting session creation.
        const runtime = createWebStartupTraceRuntime(() => { throw new Error('writer unavailable'); });
        const handle = runtime.begin(TRACE_A, 100);

        expect(runtime.bindSession(handle, '')).toBe(false);
        expect(runtime.mark(handle, 'web.processor.ready_received', 200)).toBe(true);
        expect(runtime.mark(handle, 'not-a-stage' as any, 200)).toBe(false);
        expect(() => runtime.cancel(handle, '')).not.toThrow();
        expect(() => runtime.mark({ traceId: TRACE_A, startedAt: 100 }, 'web.processor.ready_received')).not.toThrow();
    });
});
