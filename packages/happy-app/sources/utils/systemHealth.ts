import { z } from 'zod';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';

const NonNegativeFinite = z.number().finite().nonnegative();
const SourceSchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(40),
    cpuPercent: NonNegativeFinite,
    rssBytes: NonNegativeFinite,
    processCount: NonNegativeFinite,
    zombieProcessCount: NonNegativeFinite,
    oldestProcessAgeSeconds: NonNegativeFinite.optional(),
});
const CurrentSchema = z.object({
    sampledAt: NonNegativeFinite,
    cpuUsedPercent: NonNegativeFinite,
    cpuCores: NonNegativeFinite,
    load1: NonNegativeFinite,
    load5: NonNegativeFinite,
    load15: NonNegativeFinite,
    memoryTotalBytes: NonNegativeFinite,
    memoryAvailableBytes: NonNegativeFinite,
    memoryCompressedBytes: NonNegativeFinite,
    memoryPressureFreePercent: NonNegativeFinite.optional(),
    swapUsedBytes: NonNegativeFinite,
    swapTotalBytes: NonNegativeFinite,
    diskFreeBytes: NonNegativeFinite.optional(),
    diskTotalBytes: NonNegativeFinite.optional(),
    processCount: NonNegativeFinite,
    processLimit: NonNegativeFinite.optional(),
    zombieProcessCount: NonNegativeFinite,
    pawsWorkerRoots: NonNegativeFinite,
    pawsWorkerProcesses: NonNegativeFinite,
    pawsWorkerRssBytes: NonNegativeFinite,
    orphanWorkerRoots: NonNegativeFinite,
    orphanWorkerProcesses: NonNegativeFinite,
    orphanWorkerRssBytes: NonNegativeFinite,
    topCpuSources: z.array(SourceSchema).max(5),
    topMemorySources: z.array(SourceSchema).max(5),
    topZombieSources: z.array(SourceSchema).max(5),
});
const HistoryPointSchema = z.object({
    sampledAt: NonNegativeFinite,
    cpuUsedPercent: NonNegativeFinite,
    load1: NonNegativeFinite,
    memoryAvailableBytes: NonNegativeFinite,
    swapUsedBytes: NonNegativeFinite,
    processCount: NonNegativeFinite,
    zombieProcessCount: NonNegativeFinite,
    orphanWorkerRoots: NonNegativeFinite,
    pawsWorkerRssBytes: NonNegativeFinite,
});
const IssueSchema = z.object({
    code: z.enum([
        'orphan-workers',
        'swap-high',
        'swap-growing',
        'cpu-sustained',
        'load-high',
        'memory-pressure-high',
        'worker-memory-high',
        'process-count-high',
        'process-capacity-high',
        'zombie-processes',
        'disk-low',
        'single-source-cpu-high',
    ]),
    severity: z.enum(['warning', 'critical']),
    subject: z.string().max(64).optional(),
    observed: z.number().finite(),
    threshold: NonNegativeFinite,
    unit: z.enum(['percent', 'ratio', 'bytes', 'count']),
    since: NonNegativeFinite,
});
export const AppSystemHealthSnapshotSchema = z.object({
    schemaVersion: z.literal(1),
    platform: z.literal('darwin'),
    updatedAt: NonNegativeFinite.nullable(),
    lastAttemptAt: NonNegativeFinite.nullable(),
    resourceStatus: z.enum(['healthy', 'warning', 'critical']),
    issues: z.array(IssueSchema).max(16),
    current: CurrentSchema.nullable(),
    history: z.array(HistoryPointSchema).max(30),
    collector: z.object({
        intervalSeconds: z.literal(15),
        historyStepSeconds: z.literal(60),
        durationMs: NonNegativeFinite,
        lastSampleKind: z.enum(['complete', 'partial', 'failed', 'pending']),
        errors: z
            .array(
                z.object({
                    command: z.enum([
                        'sysctl',
                        'launchctl',
                        'top',
                        'vm_stat',
                        'memory_pressure',
                        'ps',
                        'df',
                    ]),
                    code: z.enum(['timeout', 'exit', 'parse']),
                })
            )
            .max(16),
    }),
});

export type SystemHealthSnapshot = z.infer<
    typeof AppSystemHealthSnapshotSchema
>;
export type SystemHealthCurrent = z.infer<typeof CurrentSchema>;
export type SystemHealthSource = z.infer<typeof SourceSchema>;
export type SystemHealthStatus =
    | 'healthy'
    | 'warning'
    | 'critical'
    | 'unavailable'
    | 'offline';
export type SystemHealthAvailability =
    | 'hidden'
    | 'unsupported'
    | 'disabled'
    | 'pending'
    | 'collecting'
    | 'unavailable'
    | 'available';
export type SystemHealthDiagnostic = { code: 'invalid-snapshot' };
export type SystemHealthCollectorErrorCategory = Pick<
    SystemHealthSnapshot['collector']['errors'][number],
    'command' | 'code'
>;

export interface SystemHealthChartAccessibilitySummary {
    labelKey: string;
    summaryKey: string;
    latest: number | null;
    min: number | null;
    max: number | null;
}

export interface SystemHealthChartModel {
    key:
        | 'cpuUsedPercent'
        | 'swapUsedBytes'
        | 'processCount'
        | 'zombieProcessCount'
        | 'orphanWorkerRoots';
    labelKey: string;
    unit: 'percent' | 'gigabytes' | 'count';
    points: Array<{ sampledAt: number; value: number }>;
    latest: number | null;
    min: number | null;
    max: number | null;
    accessibilitySummary: SystemHealthChartAccessibilitySummary;
}

export interface SystemHealthViewModel {
    visible: boolean;
    availability: SystemHealthAvailability;
    status: SystemHealthStatus;
    snapshot: SystemHealthSnapshot | null;
    current: SystemHealthCurrent | null;
    ageMs: number | null;
    delayed: boolean;
    charts: SystemHealthChartModel[];
    collectorErrorCategories: SystemHealthCollectorErrorCategory[];
    diagnostics: SystemHealthDiagnostic[];
}

function systemHealthPayload(daemonState: unknown): {
    present: boolean;
    value: unknown;
} {
    if (!daemonState || typeof daemonState !== 'object')
        return { present: false, value: undefined };
    const state = daemonState as Record<string, unknown>;
    const value = state.systemHealth;
    return { present: value !== undefined, value };
}

export function parseSystemHealth(
    daemonState: unknown
): SystemHealthSnapshot | null {
    const { value } = systemHealthPayload(daemonState);
    const parsed = AppSystemHealthSnapshotSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

export function getSystemHealthAvailability(
    machine: Machine,
    now: number
): SystemHealthAvailability {
    if (machine.metadata?.platform !== 'darwin') return 'hidden';
    const capability = machine.metadata?.systemHealthMonitor;
    if (!capability) return 'unsupported';
    if (!capability.enabled) return 'disabled';
    const payload = systemHealthPayload(machine.daemonState);
    const snapshot = parseSystemHealth(machine.daemonState);
    if (!snapshot) {
        if (payload.present) return 'unavailable';
        return now - capability.reportedAt <= 45_000
            ? 'pending'
            : 'unavailable';
    }
    if (!snapshot.current || snapshot.updatedAt === null) {
        return now - capability.reportedAt <= 45_000
            ? 'pending'
            : 'unavailable';
    }
    return 'available';
}

function sanitizedHistory(snapshot: SystemHealthSnapshot, now: number) {
    const byMinute = new Map<number, SystemHealthSnapshot['history'][number]>();
    for (const point of [...snapshot.history].sort(
        (a, b) => a.sampledAt - b.sampledAt
    )) {
        if (point.sampledAt > now + 5 * 60_000) continue;
        byMinute.set(Math.floor(point.sampledAt / 60_000), point);
    }
    return [...byMinute.values()].sort((a, b) => a.sampledAt - b.sampledAt);
}

function chart(
    key: SystemHealthChartModel['key'],
    labelKey: string,
    unit: SystemHealthChartModel['unit'],
    history: ReturnType<typeof sanitizedHistory>
): SystemHealthChartModel {
    const points = history.map((point) => ({
        sampledAt: point.sampledAt,
        value: key === 'swapUsedBytes' ? point[key] / 1024 ** 3 : point[key],
    }));
    const values = points.map((point) => point.value);
    const latest = values.at(-1) ?? null;
    const min = values.length > 0 ? Math.min(...values) : null;
    const max = values.length > 0 ? Math.max(...values) : null;
    return {
        key,
        labelKey,
        unit,
        points,
        latest,
        min,
        max,
        accessibilitySummary: {
            labelKey,
            summaryKey: 'machine.systemHealth.chartSummary',
            latest,
            min,
            max,
        },
    };
}

export function buildSystemHealthViewModel(
    machine: Machine,
    now: number
): SystemHealthViewModel {
    const availability = getSystemHealthAvailability(machine, now);
    const parsed = parseSystemHealth(machine.daemonState);
    const payload = systemHealthPayload(machine.daemonState);
    const snapshot = parsed
        ? { ...parsed, history: sanitizedHistory(parsed, now) }
        : null;
    const ageMs =
        snapshot?.updatedAt === null || snapshot?.updatedAt === undefined
            ? null
            : Math.max(0, now - snapshot.updatedAt);
    let status: SystemHealthStatus = 'unavailable';
    if (!isMachineOnline(machine)) status = 'offline';
    else if (!snapshot?.current || ageMs === null || ageMs > 120_000)
        status = 'unavailable';
    else if (snapshot.resourceStatus === 'critical') status = 'critical';
    else if (snapshot.resourceStatus === 'warning' || ageMs > 45_000)
        status = 'warning';
    else status = 'healthy';
    const history = snapshot?.history ?? [];
    return {
        visible: availability !== 'hidden',
        availability,
        status,
        snapshot,
        current: snapshot?.current ?? null,
        ageMs,
        delayed: ageMs !== null && ageMs > 45_000,
        charts: [
            chart(
                'cpuUsedPercent',
                'machine.systemHealth.metrics.cpu',
                'percent',
                history
            ),
            chart(
                'swapUsedBytes',
                'machine.systemHealth.metrics.swap',
                'gigabytes',
                history
            ),
            chart(
                'processCount',
                'machine.systemHealth.metrics.processes',
                'count',
                history
            ),
            chart(
                'zombieProcessCount',
                'machine.systemHealth.metrics.zombies',
                'count',
                history
            ),
            chart(
                'orphanWorkerRoots',
                'machine.systemHealth.metrics.orphans',
                'count',
                history
            ),
        ],
        collectorErrorCategories: snapshot
            ? [
                  ...new Map(
                      snapshot.collector.errors.map((error) => [
                          `${error.command}:${error.code}`,
                          error,
                      ])
                  ).values(),
              ]
            : [],
        diagnostics:
            !parsed && payload.present ? [{ code: 'invalid-snapshot' }] : [],
    };
}
