import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createWebStartupTraceRuntime } from './sessionStartupTraceRuntime';
import { markSessionCriticalPathAppStage } from './sessionCriticalPathProbeBridge';

import {
    sanitizeSessionStartupTrace,
    serializeSessionStartupTrace,
    traceStartup,
} from './sessionStartupTrace';

describe('session startup trace serialization', () => {
    it('synchronously captures the real trace-to-probe spawn sequence on the browser clock', () => {
        const source = execFileSync(process.execPath, ['scripts/check-session-critical-path.mjs',
            '--origin', 'https://example.test', '--session-id', 'unused', '--mode', 'print-phase-2-ego-probe'], { encoding: 'utf8' });
        let time = 100;
        const probe = vm.runInNewContext(source, {
            URL, fetch: () => Promise.resolve({}),
            XMLHttpRequest: class { open() {} send() {} },
            document: { readyState: 'loading', scripts: [], baseURI: 'https://example.test' },
            performance: { now: () => time, getEntriesByType: () => [] },
            PerformanceObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
        });
        (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe = probe;
        const logger = vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('logger failure'); });
        const runtime = createWebStartupTraceRuntime();
        const traceId = '00000000-0000-4000-8000-000000000001';
        const handle = runtime.begin(traceId, 900_000);
        runtime.bindSession(handle, 'private-session');
        const trace = (stage: string) => traceStartup({ traceId, stage, outcome: 'success',
            timestamp: 1_700_000_000_000, duration: 999_999, sessionId: 'private-session', machineId: 'private-machine' });
        try {
            probe.configureSample({ kind: 'spawn', cache: 'cold' });
            trace('web.spawn.clicked');
            time = 200; trace('web.session.hydrated');
            time = 300; trace('web.first_message.queued');
            time = 400; trace('web.session.navigated');
            time = 600; markSessionCriticalPathAppStage('web.session.route_painted');
            time = 800; runtime.markSessionStage('private-session', 'web.processor.ready_received', 900_500);
            time = 850; expect(runtime.markSessionStage('private-session', 'web.processor.ready_received', 900_600)).toBe(false);
            time = 900; runtime.markSessionStage('private-session', 'web.first_agent_event_received', 900_700);
            time = 1000; runtime.markSessionStage('private-session', 'web.turn.completed', 900_800);
            expect(JSON.parse(JSON.stringify(probe.collect()))).toEqual({ resources: [], samples: [
                { kind: 'spawn', cache: 'cold', retryCount: 0, spawnRoutePaintMs: 500, processorReadyMs: 700,
                    stages: [
                        { stage: 'web.spawn.clicked', duration: 0 },
                        { stage: 'web.session.hydrated', duration: 100 },
                        { stage: 'web.first_message.queued', duration: 200 },
                        { stage: 'web.session.navigated', duration: 300 },
                        { stage: 'web.session.route_painted', duration: 500 },
                        { stage: 'web.processor.ready_received', duration: 700 },
                        { stage: 'web.first_agent_event_received', duration: 800 },
                        { stage: 'web.turn.completed', duration: 900 },
                    ],
                },
            ] });
        } finally {
            runtime.finish(handle);
            logger.mockRestore();
            delete (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe;
        }
    });

    it('passes only fixed stages to the probe and contains probe failures', () => {
        const calls: unknown[][] = [];
        const logger = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe = {
            markAppStage: (...args: unknown[]) => { calls.push(args); throw new Error('private-probe-error'); },
        };
        const event = { traceId: '00000000-0000-4000-8000-000000000001', stage: 'web.session.navigated',
            timestamp: 42, duration: 35, sessionId: 'private-session', outcome: 'success' };
        try {
            expect(() => traceStartup(event)).not.toThrow();
            traceStartup({ ...event, outcome: 'error' });
            traceStartup({ ...event, stage: 'server.rpc.received' });
            expect(calls).toEqual([['web.session.navigated']]);
        } finally {
            logger.mockRestore();
            delete (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe;
        }
    });
    it.each([
        'web.processor.ready_received',
        'web.first_agent_event_received',
        'web.turn.completed',
    ] as const)('serializes the fixed browser startup attribution stage %s', (stage) => {
        // Catches a production allowlist regression that silently drops browser attribution.
        expect(JSON.parse(serializeSessionStartupTrace({
            traceId: '00000000-0000-4000-8000-000000000003',
            stage,
            duration: 250,
        })!)).toEqual({
            traceId: '00000000-0000-4000-8000-000000000003',
            stage,
            duration: 250,
        });
    });

    it('retains only the startup trace allowlist', () => {
        const serialized = serializeSessionStartupTrace({
            traceId: '00000000-0000-4000-8000-000000000001',
            stage: 'web.session.hydrated',
            timestamp: 1_725_000_000_000,
            duration: 321,
            outcome: 'error',
            sessionId: 'session-1',
            machineId: 'machine-1',
            errorCode: 'session-hydration-failed',
            token: 'token-canary',
            secret: 'secret-canary',
            apiKey: 'key-canary',
            ciphertext: 'ciphertext-canary',
            prompt: 'prompt-canary',
            message: 'message-canary',
            directory: '/private/directory-canary',
            dataEncryptionKey: 'encryption-key-canary',
            downloadUrl: 'https://download.invalid/canary',
            uploadUrl: 'https://upload.invalid/canary',
            authorization: 'Bearer authorization-canary',
            infrastructureAddress: 'https://relay.internal.invalid',
            error: 'raw-error-canary',
            stack: 'raw-stack-canary',
            arbitrary: 'arbitrary-canary',
        });

        expect(JSON.parse(serialized!)).toEqual({
            traceId: '00000000-0000-4000-8000-000000000001',
            stage: 'web.session.hydrated',
            timestamp: 1_725_000_000_000,
            duration: 321,
            outcome: 'error',
            sessionId: 'session-1',
            machineId: 'machine-1',
            errorCode: 'session-hydration-failed',
        });
        expect(serialized).not.toContain('canary');
    });

    it('logs only the serialized allowlisted object', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        try {
            traceStartup({
                traceId: '00000000-0000-4000-8000-000000000002',
                stage: 'web.spawn.clicked',
                timestamp: 1_725_000_000_100,
                outcome: 'success',
                token: 'token-canary',
            });

            expect(info).toHaveBeenCalledOnce();
            expect(info).toHaveBeenCalledWith(JSON.stringify({
                traceId: '00000000-0000-4000-8000-000000000002',
                stage: 'web.spawn.clicked',
                timestamp: 1_725_000_000_100,
                outcome: 'success',
            }));
        } finally {
            info.mockRestore();
        }
    });

    it.each([
        null,
        [],
        { traceId: 'not-a-uuid', stage: 'web.spawn.clicked' },
        { traceId: '00000000-0000-4000-8000-000000000001', stage: 'unknown-stage' },
        { traceId: '00000000-0000-4000-8000-000000000001', stage: 'web.spawn.clicked', outcome: 'maybe' },
        { traceId: '00000000-0000-4000-8000-000000000001', stage: 'web.spawn.clicked', timestamp: Number.NaN },
    ])('rejects malformed startup trace values without throwing (%j)', (event) => {
        expect(() => sanitizeSessionStartupTrace(event as any)).not.toThrow();
        expect(sanitizeSessionStartupTrace(event as any)).toBeNull();
        expect(serializeSessionStartupTrace(event as any)).toBeNull();
    });

    it('ignores nested and cyclic non-allowlisted data without throwing', () => {
        const event: Record<string, unknown> = {
            traceId: '00000000-0000-4000-8000-000000000001',
            stage: 'web.spawn.clicked',
            outcome: 'success',
            nested: { token: 'token-canary' },
        };
        event.cycle = event;

        expect(serializeSessionStartupTrace(event as any)).toBe(JSON.stringify({
            traceId: '00000000-0000-4000-8000-000000000001',
            stage: 'web.spawn.clicked',
            outcome: 'success',
        }));
    });

    it('snapshots each allowed property once so a stateful getter cannot bypass validation', () => {
        const secret: Record<string, unknown> = { token: 'getter-secret-canary' };
        secret.cycle = secret;
        let traceIdReads = 0;
        const event = {
            get traceId() {
                traceIdReads += 1;
                return traceIdReads === 1
                    ? '00000000-0000-4000-8000-000000000001'
                    : secret;
            },
            stage: 'web.spawn.clicked',
            nested: secret,
        };

        let serialized: string | null | undefined;
        expect(() => { serialized = serializeSessionStartupTrace(event); }).not.toThrow();
        expect(traceIdReads).toBe(1);
        expect(serialized).toBe(JSON.stringify({
            traceId: '00000000-0000-4000-8000-000000000001',
            stage: 'web.spawn.clicked',
        }));
        expect(serialized).not.toContain('canary');
    });

    it('never lets serialization or console failures escape into startup logic', () => {
        const throwingEvent = Object.defineProperty({}, 'traceId', {
            get: () => { throw new Error('getter-canary'); },
        });
        const info = vi.spyOn(console, 'info').mockImplementation(() => {
            throw new Error('logger-canary');
        });
        try {
            expect(() => traceStartup(throwingEvent as any)).not.toThrow();
            expect(() => traceStartup({
                traceId: '00000000-0000-4000-8000-000000000001',
                stage: 'web.spawn.clicked',
            })).not.toThrow();
        } finally {
            info.mockRestore();
        }
    });
});
