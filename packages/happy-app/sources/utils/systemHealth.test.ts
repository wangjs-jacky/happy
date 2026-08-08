import { describe, expect, it } from 'vitest';
import type { Machine } from '@/sync/storageTypes';
import { buildSystemHealthViewModel, parseSystemHealth } from './systemHealth';

const now = 1_800_000;

function machine(overrides: Partial<Machine> = {}, sampleOverrides: Record<string, unknown> = {}): Machine {
    const current = {
        sampledAt: now - 5_000,
        cpuUsedPercent: 20,
        cpuCores: 10,
        load1: 1,
        load5: 1,
        load15: 1,
        memoryTotalBytes: 16_000,
        memoryAvailableBytes: 8_000,
        memoryCompressedBytes: 1_000,
        swapUsedBytes: 500,
        swapTotalBytes: 4_000,
        processCount: 300,
        processLimit: 4_000,
        zombieProcessCount: 0,
        pawsWorkerRoots: 1,
        pawsWorkerProcesses: 2,
        pawsWorkerRssBytes: 100,
        orphanWorkerRoots: 0,
        orphanWorkerProcesses: 0,
        orphanWorkerRssBytes: 0,
        topCpuSources: [],
        topMemorySources: [],
        topZombieSources: [],
    };
    const point = {
        sampledAt: current.sampledAt,
        cpuUsedPercent: current.cpuUsedPercent,
        load1: current.load1,
        memoryAvailableBytes: current.memoryAvailableBytes,
        swapUsedBytes: current.swapUsedBytes,
        processCount: current.processCount,
        zombieProcessCount: current.zombieProcessCount,
        orphanWorkerRoots: current.orphanWorkerRoots,
        pawsWorkerRssBytes: current.pawsWorkerRssBytes,
    };
    return {
        id: 'machine', seq: 1, createdAt: 0, updatedAt: 0, active: true, activeAt: now,
        metadataVersion: 1, daemonStateVersion: 1,
        metadata: {
            host: 'mac', platform: 'darwin', happyCliVersion: '1', homeDir: '/tmp', happyHomeDir: '/tmp/.happy',
            systemHealthMonitor: { schemaVersion: 1, supported: true, enabled: true, reportedAt: now - 10_000 },
        },
        daemonState: {
            systemHealth: {
                schemaVersion: 1, platform: 'darwin', updatedAt: current.sampledAt, lastAttemptAt: current.sampledAt,
                resourceStatus: 'healthy', current, history: [point], issues: [],
                collector: { intervalSeconds: 15, historyStepSeconds: 60, durationMs: 10, lastSampleKind: 'complete', errors: [] },
                ...sampleOverrides,
            },
        },
        ...overrides,
    };
}

describe('system health view model', () => {
    it.each([
        ['offline', machine({ active: false, activeAt: 0 }), 'offline'],
        ['stale', machine({}, { updatedAt: now - 121_000, current: { ...machine().daemonState.systemHealth.current, sampledAt: now - 121_000 } }), 'unavailable'],
        ['critical', machine({}, { resourceStatus: 'critical' }), 'critical'],
        ['delayed', machine({}, { updatedAt: now - 46_000 }), 'warning'],
        ['healthy', machine(), 'healthy'],
    ])('%s resolves final status by priority', (_name, value, expected) => {
        expect(buildSystemHealthViewModel(value, now).status).toBe(expected);
    });

    it('distinguishes unsupported, disabled, pending and non-macOS states', () => {
        expect(buildSystemHealthViewModel(machine({ metadata: { ...machine().metadata!, systemHealthMonitor: undefined } }), now).availability).toBe('unsupported');
        expect(buildSystemHealthViewModel(machine({ metadata: { ...machine().metadata!, systemHealthMonitor: { schemaVersion: 1, supported: true, enabled: false, reportedAt: now } } }), now).availability).toBe('disabled');
        expect(buildSystemHealthViewModel(machine({ daemonState: null }), now).availability).toBe('pending');
        expect(buildSystemHealthViewModel(machine({ metadata: { ...machine().metadata!, platform: 'linux' } }), now).visible).toBe(false);
    });

    it('builds five independently scaled series and removes duplicate/future buckets', () => {
        const base = machine();
        const point = base.daemonState.systemHealth.history[0];
        const value = machine({}, { history: [point, { ...point, sampledAt: point.sampledAt + 1_000, zombieProcessCount: 3 }, { ...point, sampledAt: now + 6 * 60_000 }] });
        const view = buildSystemHealthViewModel(value, now);
        expect(view.charts).toHaveLength(5);
        expect(view.charts.find((item) => item.key === 'zombieProcessCount')).toMatchObject({ latest: 3, min: 3, max: 3 });
        expect(view.charts.every((item) => item.points.length === 1)).toBe(true);
    });

    it('rejects malformed and unknown-version payloads without throwing', () => {
        expect(parseSystemHealth({ systemHealth: { schemaVersion: 2 } })).toBeNull();
        expect(parseSystemHealth({ systemHealth: { schemaVersion: 1, current: { processCount: -1 } } })).toBeNull();
    });
});
