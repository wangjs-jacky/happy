import { describe, expect, it, vi } from 'vitest';

import { DaemonSessionStartupIntegration } from './run';
import { createDaemonStartupTraceContext } from './sessionStartupTrace';
import { spawnHappyCLI } from '@/utils/spawnHappyCLI';
import { logger } from '@/ui/logger';

const spawnLog = vi.hoisted(() => ({ lines: [] as string[], missing: false, fail: false, calls: [] as any[][] }));
vi.mock('fs', async importOriginal => ({
    ...await importOriginal<typeof import('fs')>(),
    appendFileSync: (_path: unknown, value: unknown) => { spawnLog.lines.push(String(value)); },
}));
vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual,
        appendFileSync: (_path: unknown, value: unknown) => { spawnLog.lines.push(String(value)); },
        existsSync: (path: any) => /dist\/(index|codexWorkerEntry)\.mjs$/.test(String(path)) ? !spawnLog.missing : actual.existsSync(path) };
});
vi.mock('cross-spawn', () => ({ spawn: (...args: any[]) => {
    spawnLog.calls.push(args);
    if (spawnLog.fail) throw new Error('synthetic-spawn-error');
    return { pid: 101 };
} }));

const TRACE_ID = '00000000-0000-4000-8000-000000000001';

function trace() {
    return createDaemonStartupTraceContext({ traceId: TRACE_ID, machineId: 'machine-1' }, () => 100)!;
}

describe('run.ts daemon session startup integration', () => {
    it.each([
        ['codex', 'codexWorkerEntry.mjs'],
        ['claude', 'index.mjs'],
        ['opencode', 'index.mjs'],
        ['gemini', 'index.mjs'],
        ['openclaw', 'index.mjs'],
        [undefined, 'index.mjs'],
    ] as const)('spawns daemon %s using %s with the original arguments and reconnect environment', (agent, filename) => {
        const integration = new DaemonSessionStartupIntegration();
        const args = ['codex', '--started-by', 'daemon', '--resume', 'thread-1'];
        const env = integration.buildWorkerEnvironment('regular', { PATH: '/bin' }, {
            HAPPY_RECONNECT_SESSION_ID: 'session-1',
            HAPPY_RECONNECT_METADATA_JSON: '{"codexThreadId":"thread-1"}',
        }, TRACE_ID);

        const child = integration.spawnWorker(agent, args, { cwd: '/test', env });

        const [runtime, actualArgs, actualOptions] = spawnLog.calls.at(-1)!;
        expect(child.pid).toBe(101);
        expect(runtime).toBe(process.execPath);
        expect(actualArgs).toEqual([
            '--no-warnings', '--no-deprecation', expect.stringMatching(new RegExp(`/dist/${filename}$`)), ...args,
        ]);
        expect(actualOptions).toEqual({ windowsHide: true, cwd: '/test', env });
    });

    it('keeps generic codex and daemon invocations on main unless an entrypoint is explicitly selected', () => {
        spawnHappyCLI(['codex', '--started-by', 'daemon']);
        expect(spawnLog.calls.at(-1)![1][2]).toMatch(/\/dist\/index\.mjs$/);
    });

    it('selects the dedicated artifact without forwarding its internal option to child_process', () => {
        spawnHappyCLI(['codex', '--started-by', 'daemon'], { entrypoint: 'codex-worker' });
        const [, args, options] = spawnLog.calls.at(-1)!;
        expect(args[2]).toMatch(/\/dist\/codexWorkerEntry\.mjs$/);
        expect(options).toEqual({ windowsHide: true });
    });

    it('records request receipt before child start with component-local spans', () => {
        const events: Record<string, unknown>[] = [];
        const ticks = [100, 100, 145];
        const wallTicks = [1000, 1045];
        const integration = new DaemonSessionStartupIntegration(
            (_label, event) => events.push(event),
            () => ticks.shift()!,
            () => wallTicks.shift()!,
        );

        const requestTrace = integration.requestReceived({
            traceId: TRACE_ID,
            machineId: 'machine-1',
            directory: '/directory-canary',
            command: 'command-canary',
            environment: { TOKEN: 'token-canary' },
        } as any);
        integration.childStarted(101, requestTrace);

        expect(events).toEqual([
            { traceId: TRACE_ID, stage: 'daemon.spawn.request_received', timestamp: 1000, duration: 0, spanDuration: 0, outcome: 'success', machineId: 'machine-1' },
            { traceId: TRACE_ID, stage: 'daemon.spawn.child_started', timestamp: 1045, duration: 45, spanDuration: 45, outcome: 'success', machineId: 'machine-1' },
        ]);
        expect(JSON.stringify(events)).not.toContain('canary');
    });
    it('keeps command, directory and raw failures out of the real worker spawn logger', () => {
        spawnLog.lines = [];
        const integration = new DaemonSessionStartupIntegration();
        const child = spawnHappyCLI(['codex', '--resume', 'synthetic-command-canary'], {
            cwd: '/synthetic-directory-canary',
            env: integration.buildWorkerEnvironment('regular', {}, {}, TRACE_ID),
        });
        integration.childStarted(child.pid!, trace());
        expect(child.pid).toBe(101);
        expect(spawnLog.lines.length).toBeGreaterThan(0);
        expect(spawnLog.lines.some(line => line.includes('synthetic-command-canary') || line.includes('synthetic-directory-canary'))).toBe(false);
        spawnLog.missing = true;
        let error: unknown;
        try { spawnHappyCLI(['codex']); } catch (caught) { error = caught; }
        finally { spawnLog.missing = false; }
        expect(String(error).includes('index.mjs')).toBe(false);
        expect(spawnLog.lines.some(line => line.includes('index.mjs'))).toBe(false);
        spawnLog.fail = true;
        try { expect(() => spawnHappyCLI(['codex'])).toThrow('WORKER_SPAWN_FAILED'); }
        finally { spawnLog.fail = false; }
        expect(spawnLog.lines.some(line => line.includes('synthetic-spawn-error'))).toBe(false);
        const debug = vi.spyOn(logger, 'debug').mockImplementation(() => { throw new Error('synthetic-log-failure'); });
        try { expect(spawnHappyCLI(['codex']).pid).toBe(101); }
        finally { debug.mockRestore(); }
    });
    it.each(['regular', 'tmux'] as const)('constructs the scrubbed %s worker environment used by run.ts', (mode) => {
        const integration = new DaemonSessionStartupIntegration();

        const env = integration.buildWorkerEnvironment(
            mode,
            { PATH: '/bin', UNDEFINED_BASE: undefined, HAPPY_SESSION_STARTUP_TRACE_ID: 'inherited-canary' },
            { USER_OPTION: 'kept', HAPPY_SESSION_STARTUP_TRACE_ID: 'caller-canary' },
            TRACE_ID,
        );

        expect(env).toEqual({
            PATH: '/bin',
            ...(mode === 'regular' ? { UNDEFINED_BASE: undefined } : {}),
            USER_OPTION: 'kept',
            HAPPY_SESSION_STARTUP_TRACE_ID: TRACE_ID,
        });
    });

    it.each([undefined, '', 'legacy-trace', '00000000-0000-0000-0000-000000000000'])
    ('scrubs contamination when run.ts receives an absent or invalid trace (%j)', (traceId) => {
        const integration = new DaemonSessionStartupIntegration();

        expect(integration.buildWorkerEnvironment(
            'regular',
            { HAPPY_SESSION_STARTUP_TRACE_ID: 'inherited-canary' },
            { HAPPY_SESSION_STARTUP_TRACE_ID: 'caller-canary' },
            traceId,
        )).toEqual({});
    });

    it('owns one PID, ignores foreign and duplicate trace webhooks, and mutates only valid callbacks', () => {
        const write = vi.fn();
        const integration = new DaemonSessionStartupIntegration(write, () => 200);
        const mutations: string[] = [];
        integration.childStarted(101, trace());

        expect(integration.processWebhook(999, 'foreign-session', () => mutations.push('foreign'))).toBe(true);
        expect(integration.processWebhook(101, 'session-1', () => mutations.push('owned'))).toBe(true);
        expect(integration.processWebhook(101, 'duplicate-session', () => mutations.push('duplicate'))).toBe(true);

        expect(mutations).toEqual(['foreign', 'owned', 'duplicate']);
        expect(integration.pendingTraceCount).toBe(0);
        const webhookEvents = write.mock.calls.filter(([, event]) => event.stage === 'daemon.spawn.webhook_received');
        expect(webhookEvents).toHaveLength(1);
        expect(webhookEvents[0][1]).toEqual(expect.objectContaining({
            traceId: TRACE_ID,
            sessionId: 'session-1',
        }));
    });

    it.each(['', '   '] as const)('rejects invalid webhook sessionId before mutation, then accepts valid success (%j)', (invalidId) => {
        const integration = new DaemonSessionStartupIntegration(vi.fn());
        const mutate = vi.fn();
        integration.childStarted(101, trace());

        expect(integration.processWebhook(101, invalidId, mutate)).toBe(false);
        expect(mutate).not.toHaveBeenCalled();
        expect(integration.pendingTraceCount).toBe(1);

        expect(integration.processWebhook(101, 'session-1', mutate)).toBe(true);
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(integration.pendingTraceCount).toBe(0);
    });

    it('keeps an invalid webhook pending until timeout cleanup', () => {
        const integration = new DaemonSessionStartupIntegration(vi.fn());
        const mutate = vi.fn();
        integration.childStarted(101, trace());

        expect(integration.processWebhook(101, ' ', mutate)).toBe(false);
        integration.webhookTimeout(101);

        expect(mutate).not.toHaveBeenCalled();
        expect(integration.pendingTraceCount).toBe(0);
    });

    it.each(['childExited', 'sessionStopped', 'staleProcessPruned'] as const)
    ('cleans the PID association through the run.ts %s branch', (branch) => {
        const integration = new DaemonSessionStartupIntegration(vi.fn());
        integration.childStarted(101, trace());

        integration[branch](101);

        expect(integration.pendingTraceCount).toBe(0);
    });

    it('keeps child and webhook control flow alive when the production logger throws', () => {
        const write = vi.fn(() => { throw new Error('logger-canary'); });
        const integration = new DaemonSessionStartupIntegration(write);
        const mutate = vi.fn();

        expect(() => integration.childStarted(101, trace())).not.toThrow();
        expect(integration.pendingTraceCount).toBe(1);
        expect(() => integration.processWebhook(101, 'session-1', mutate)).not.toThrow();
        expect(mutate).toHaveBeenCalledOnce();
        expect(integration.pendingTraceCount).toBe(0);
    });
});
