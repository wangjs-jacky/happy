import { describe, expect, it, vi } from 'vitest';

import {
    DaemonStartupTraceRegistry,
    buildSessionWorkerEnvironment,
    createDaemonStartupTraceContext,
    logDaemonStartupStage,
} from './sessionStartupTrace';

const TRACE_ID = '00000000-0000-4000-8000-000000000001';

describe('daemon session startup tracing', () => {
    it.each(['regular', 'tmux'])('scrubs inherited and caller trace contamination for %s workers', () => {
        const env = buildSessionWorkerEnvironment(
            { PATH: '/bin', HAPPY_SESSION_STARTUP_TRACE_ID: 'inherited-canary' },
            { USER_OPTION: 'kept', HAPPY_SESSION_STARTUP_TRACE_ID: 'caller-canary' },
            TRACE_ID,
        );

        expect(env).toEqual({
            PATH: '/bin',
            USER_OPTION: 'kept',
            HAPPY_SESSION_STARTUP_TRACE_ID: TRACE_ID,
        });
    });

    it.each([undefined, '', 'legacy-trace', '00000000-0000-0000-0000-000000000000'])
    ('removes stale trace state when the incoming trace is invalid (%j)', (traceId) => {
        expect(buildSessionWorkerEnvironment(
            { HAPPY_SESSION_STARTUP_TRACE_ID: 'inherited-canary' },
            { HAPPY_SESSION_STARTUP_TRACE_ID: 'caller-canary' },
            traceId,
        )).toEqual({});
    });

    it('associates one trace with its PID and ignores foreign or duplicate webhooks', () => {
        const write = vi.fn();
        const registry = new DaemonStartupTraceRegistry(write, () => 200);
        const trace = createDaemonStartupTraceContext({ traceId: TRACE_ID, machineId: 'machine-1' }, () => 100);
        expect(trace).toBeDefined();

        registry.associate(101, trace!);
        expect(registry.size).toBe(1);
        expect(registry.webhookReceived(999, 'foreign-session')).toBe(false);
        expect(registry.webhookReceived(101, 'session-1')).toBe(true);
        expect(registry.webhookReceived(101, 'duplicate-session')).toBe(false);
        expect(registry.size).toBe(0);
        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0][1]).toEqual(expect.objectContaining({
            traceId: TRACE_ID,
            stage: 'daemon.spawn.webhook_received',
            duration: 100,
            sessionId: 'session-1',
        }));
    });

    it('cleans PID associations on timeout or child exit', () => {
        const registry = new DaemonStartupTraceRegistry(vi.fn());
        const trace = createDaemonStartupTraceContext({ traceId: TRACE_ID });
        registry.associate(101, trace!);
        registry.associate(102, trace!);

        registry.delete(101);
        registry.delete(102);

        expect(registry.size).toBe(0);
    });

    it('never lets daemon telemetry logger failures affect control flow', () => {
        const write = vi.fn(() => { throw new Error('logger-canary'); });
        const trace = createDaemonStartupTraceContext({ traceId: TRACE_ID });
        const registry = new DaemonStartupTraceRegistry(write);
        registry.associate(101, trace!);

        expect(() => logDaemonStartupStage(
            trace,
            'daemon.spawn.child_started',
            { outcome: 'success' },
            write,
        )).not.toThrow();
        expect(() => registry.webhookReceived(101, 'session-1')).not.toThrow();
        expect(registry.size).toBe(0);
    });
});
