import { describe, expect, it } from 'vitest';
import type { Machine } from '@/sync/storageTypes';
import {
    buildSystemHealthViewModel,
    getSystemHealthAvailability,
    parseSystemHealth,
} from './systemHealth';

const now = 1_800_000;

function machine(
    overrides: Partial<Machine> = {},
    sampleOverrides: Record<string, unknown> = {}
): Machine {
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
        id: 'machine',
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: now,
        metadataVersion: 1,
        daemonStateVersion: 1,
        metadata: {
            host: 'mac',
            platform: 'darwin',
            happyCliVersion: '1',
            homeDir: '/tmp',
            happyHomeDir: '/tmp/.happy',
            systemHealthMonitor: {
                schemaVersion: 1,
                supported: true,
                enabled: true,
                reportedAt: now - 10_000,
            },
        },
        daemonState: {
            systemHealth: {
                schemaVersion: 1,
                platform: 'darwin',
                updatedAt: current.sampledAt,
                lastAttemptAt: current.sampledAt,
                resourceStatus: 'healthy',
                current,
                history: [point],
                issues: [],
                collector: {
                    intervalSeconds: 15,
                    historyStepSeconds: 60,
                    durationMs: 10,
                    lastSampleKind: 'complete',
                    errors: [],
                },
                ...sampleOverrides,
            },
        },
        ...overrides,
    };
}

describe('system health view model', () => {
    it.each([
        ['offline', machine({ active: false, activeAt: 0 }), 'offline'],
        [
            'stale',
            machine(
                {},
                {
                    updatedAt: now - 121_000,
                    current: {
                        ...machine().daemonState.systemHealth.current,
                        sampledAt: now - 121_000,
                    },
                }
            ),
            'unavailable',
        ],
        ['critical', machine({}, { resourceStatus: 'critical' }), 'critical'],
        ['delayed', machine({}, { updatedAt: now - 46_000 }), 'warning'],
        ['healthy', machine(), 'healthy'],
    ])('%s resolves final status by priority', (_name, value, expected) => {
        expect(buildSystemHealthViewModel(value, now).status).toBe(expected);
    });

    it('distinguishes unsupported, disabled, pending and non-macOS states', () => {
        expect(
            buildSystemHealthViewModel(
                machine({
                    metadata: {
                        ...machine().metadata!,
                        systemHealthMonitor: undefined,
                    },
                }),
                now
            ).availability
        ).toBe('unsupported');
        expect(
            buildSystemHealthViewModel(
                machine({
                    metadata: {
                        ...machine().metadata!,
                        systemHealthMonitor: {
                            schemaVersion: 1,
                            supported: true,
                            enabled: false,
                            reportedAt: now,
                        },
                    },
                }),
                now
            ).availability
        ).toBe('disabled');
        expect(
            buildSystemHealthViewModel(machine({ daemonState: null }), now)
                .availability
        ).toBe('pending');
        expect(
            buildSystemHealthViewModel(
                machine({
                    metadata: { ...machine().metadata!, platform: 'linux' },
                }),
                now
            ).visible
        ).toBe(false);
    });

    it('only treats a missing first sample as pending for 45 seconds', () => {
        const pending = machine({
            daemonState: {
                systemHealth: {
                    ...machine().daemonState.systemHealth,
                    current: null,
                    updatedAt: null,
                    collector: {
                        ...machine().daemonState.systemHealth.collector,
                        lastSampleKind: 'pending',
                    },
                },
            },
        });
        expect(getSystemHealthAvailability(pending, now)).toBe('pending');

        const timedOut = machine({
            metadata: {
                ...machine().metadata!,
                systemHealthMonitor: {
                    schemaVersion: 1,
                    supported: true,
                    enabled: true,
                    reportedAt: now - 45_001,
                },
            },
            daemonState: pending.daemonState,
        });
        expect(getSystemHealthAvailability(timedOut, now)).toBe('unavailable');
    });

    it('builds five independently scaled series and removes duplicate/future buckets', () => {
        const base = machine();
        const point = base.daemonState.systemHealth.history[0];
        const value = machine(
            {},
            {
                history: [
                    point,
                    {
                        ...point,
                        sampledAt: point.sampledAt + 1_000,
                        zombieProcessCount: 3,
                    },
                    { ...point, sampledAt: now + 6 * 60_000 },
                ],
            }
        );
        const view = buildSystemHealthViewModel(value, now);
        expect(view.charts).toHaveLength(5);
        expect(
            view.charts.find((item) => item.key === 'zombieProcessCount')
        ).toMatchObject({ latest: 3, min: 3, max: 3 });
        expect(view.charts.every((item) => item.points.length === 1)).toBe(
            true
        );
    });

    it('rejects malformed and unknown-version payloads without throwing', () => {
        expect(
            parseSystemHealth({ systemHealth: { schemaVersion: 2 } })
        ).toBeNull();
        expect(
            parseSystemHealth({
                systemHealth: {
                    schemaVersion: 1,
                    current: { processCount: -1 },
                },
            })
        ).toBeNull();
    });

    it('maps invalid snapshots to unavailable and exposes only a redacted diagnostic', () => {
        const value = machine({
            daemonState: {
                systemHealth: { schemaVersion: 2, secret: 'must never escape' },
            },
        });
        const view = buildSystemHealthViewModel(value, now);

        expect(view.availability).toBe('unavailable');
        expect(view.diagnostics).toEqual([{ code: 'invalid-snapshot' }]);
        expect(JSON.stringify(view.diagnostics)).not.toContain('secret');
    });

    it('sorts history, keeps the latest sample in each minute, and does not pollute charts with future points', () => {
        const base = machine();
        const point = base.daemonState.systemHealth.history[0];
        const value = machine(
            {},
            {
                history: [
                    {
                        ...point,
                        sampledAt: now - 3 * 60_000,
                        cpuUsedPercent: 10,
                        swapUsedBytes: 1024 ** 3,
                        processCount: 10,
                        zombieProcessCount: 0,
                        orphanWorkerRoots: 0,
                    },
                    {
                        ...point,
                        sampledAt: now - 2 * 60_000 + 10_000,
                        cpuUsedPercent: 20,
                        swapUsedBytes: 2 * 1024 ** 3,
                        processCount: 20,
                        zombieProcessCount: 2,
                        orphanWorkerRoots: 1,
                    },
                    {
                        ...point,
                        sampledAt: now - 2 * 60_000 + 20_000,
                        cpuUsedPercent: 30,
                        swapUsedBytes: 3 * 1024 ** 3,
                        processCount: 30,
                        zombieProcessCount: 3,
                        orphanWorkerRoots: 2,
                    },
                    {
                        ...point,
                        sampledAt: now - 4 * 60_000,
                        cpuUsedPercent: 5,
                        swapUsedBytes: 0,
                        processCount: 5,
                        zombieProcessCount: 0,
                        orphanWorkerRoots: 0,
                    },
                    {
                        ...point,
                        sampledAt: now + 5 * 60_000 + 1,
                        cpuUsedPercent: 99,
                        swapUsedBytes: 99 * 1024 ** 3,
                        processCount: 99,
                        zombieProcessCount: 99,
                        orphanWorkerRoots: 99,
                    },
                ],
            }
        );
        const view = buildSystemHealthViewModel(value, now);
        const cpu = view.charts.find(
            (chart) => chart.key === 'cpuUsedPercent'
        )!;
        const swap = view.charts.find(
            (chart) => chart.key === 'swapUsedBytes'
        )!;

        expect(cpu.points.map((item) => item.sampledAt)).toEqual([
            now - 4 * 60_000,
            now - 3 * 60_000,
            now - 2 * 60_000 + 20_000,
        ]);
        expect(cpu).toMatchObject({ latest: 30, min: 5, max: 30 });
        expect(swap).toMatchObject({ latest: 3, min: 0, max: 3 });
        expect(view.charts.map((chart) => chart.key)).toEqual([
            'cpuUsedPercent',
            'swapUsedBytes',
            'processCount',
            'zombieProcessCount',
            'orphanWorkerRoots',
        ]);
        expect(
            view.charts.map((chart) =>
                chart.points.map((item) => item.sampledAt)
            )
        ).toEqual([
            cpu.points.map((item) => item.sampledAt),
            cpu.points.map((item) => item.sampledAt),
            cpu.points.map((item) => item.sampledAt),
            cpu.points.map((item) => item.sampledAt),
            cpu.points.map((item) => item.sampledAt),
        ]);
        expect(
            view.charts.every((chart) =>
                chart.points.every((item) => Number.isFinite(item.value))
            )
        ).toBe(true);
    });

    it('provides display-safe collector error categories and chart accessibility summaries', () => {
        const value = machine(
            {},
            {
                collector: {
                    ...machine().daemonState.systemHealth.collector,
                    errors: [
                        { command: 'top', code: 'timeout' },
                        { command: 'top', code: 'timeout' },
                        { command: 'ps', code: 'parse' },
                    ],
                },
            }
        );
        const view = buildSystemHealthViewModel(value, now);

        expect(view.collectorErrorCategories).toEqual([
            { command: 'top', code: 'timeout' },
            { command: 'ps', code: 'parse' },
        ]);
        expect(view.charts[0]?.accessibilitySummary).toEqual({
            labelKey: 'machine.systemHealth.metrics.cpu',
            summaryKey: 'machine.systemHealth.chartSummary',
            latest: 20,
            min: 20,
            max: 20,
        });
    });
});
