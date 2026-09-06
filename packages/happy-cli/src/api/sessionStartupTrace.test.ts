import { afterEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/ui/logger', () => ({
    logger: { debug: (_label: string, event: Record<string, unknown>) => events.push(event) },
}));

import { createWorkerSessionStartupLifecycleFromEnvironment, traceWorkerAuthentication } from './sessionStartupTrace';

afterEach(() => {
    events.length = 0;
    delete process.env.HAPPY_SESSION_STARTUP_TRACE_ID;
});

describe('traceWorkerAuthentication', () => {
    it('reuses the entry lifecycle after its trace environment has already been consumed', async () => {
        const environment = { HAPPY_SESSION_STARTUP_TRACE_ID: '00000000-0000-4000-8000-000000000001' };
        const lifecycle = createWorkerSessionStartupLifecycleFromEnvironment(environment);
        let receivedLifecycle: unknown;

        const result = await traceWorkerAuthentication(async (startupLifecycle) => {
            receivedLifecycle = startupLifecycle;
            startupLifecycle?.authReady();
            startupLifecycle?.machineReady('machine-1');
            return { machineId: 'machine-1' };
        }, lifecycle);

        expect(environment.HAPPY_SESSION_STARTUP_TRACE_ID).toBeUndefined();
        expect(receivedLifecycle).toBe(lifecycle);
        expect(result.startupLifecycle).toBe(lifecycle);
        expect(events.map(event => event.stage)).toEqual([
            'worker.entry.started', 'worker.auth.ready', 'worker.machine.ready',
        ]);
    });
});
