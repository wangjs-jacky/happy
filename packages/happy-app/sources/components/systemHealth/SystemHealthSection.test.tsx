import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error 测试只使用 renderer 的最小接口。
import TestRenderer from 'react-test-renderer';
import { SystemHealthSection } from './SystemHealthSection';
import { SystemHealthSparkline } from './SystemHealthSparkline';
import { SystemHealthSourceRow } from './SystemHealthSources';
import type { SystemHealthChartModel } from '@/utils/systemHealth';
import type { Machine } from '@/sync/storageTypes';
import { ca } from '@/text/translations/ca';
import { en as english } from '@/text/translations/en';
import { es } from '@/text/translations/es';
import { it as italian } from '@/text/translations/it';
import { ja } from '@/text/translations/ja';
import { pl } from '@/text/translations/pl';
import { pt } from '@/text/translations/pt';
import { ru } from '@/text/translations/ru';
import { zhHans } from '@/text/translations/zh-Hans';
import { zhHant } from '@/text/translations/zh-Hant';

const pageTestState = vi.hoisted(() => ({ online: true }));

vi.mock('react-native', () => ({
    Text: 'Text',
    View: 'View',
    ScrollView: 'ScrollView',
    ActivityIndicator: 'ActivityIndicator',
    RefreshControl: 'RefreshControl',
    Pressable: 'Pressable',
    TextInput: 'TextInput',
    Platform: { select: ({ default: defaultValue }: { default?: unknown }) => defaultValue },
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemList', () => ({ ItemList: 'ItemList' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'page-machine' }), useRouter: () => ({ back: vi.fn() }), Stack: { Screen: 'StackScreen' } }));
vi.mock('@/sync/storage', () => ({
    useSessions: () => [],
    useAllMachines: () => [],
    useMachine: () => ({
        id: 'page-machine',
        metadata: { host: 'mac', platform: 'darwin', homeDir: '/tmp', happyHomeDir: '/tmp' },
        daemonState: {},
    }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Octicons: 'Octicons' }));
vi.mock('@/sync/ops', () => ({ machineStopDaemon: vi.fn(), machineUpdateMetadata: vi.fn(), machineDelete: vi.fn(), machineSpawnNewSession: vi.fn() }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn(), prompt: vi.fn() } }));
vi.mock('@/utils/sessionUtils', () => ({ formatPathRelativeToHome: (path: string) => path, getSessionName: () => 'session', getSessionSubtitle: () => 'subtitle' }));
vi.mock('@/utils/machineUtils', () => ({ isMachineOnline: () => pageTestState.online }));
vi.mock('@/sync/sync', () => ({ sync: { refreshMachines: vi.fn() } }));
vi.mock('@/hooks/useNavigateToSession', () => ({ useNavigateToSession: () => vi.fn() }));
vi.mock('@/utils/pathUtils', () => ({ resolveAbsolutePath: (path: string) => path }));
vi.mock('@/components/MultiTextInput', () => ({ MultiTextInput: 'MultiTextInput' }));
vi.mock('react-native-unistyles', () => {
    const mockTheme = {
        colors: {
            divider: '#222', text: '#fff', textSecondary: '#aaa', warning: '#f90', warningCritical: '#f00', success: '#0f0',
            input: { background: '#111' }, groupped: { background: '#111' }, surfaceHigh: '#111', surfaceSelected: '#222',
            button: { primary: { background: '#0f0', tint: '#000' } }, permissionButton: { inactive: { background: '#333' } }, header: { tint: '#fff' },
        },
    };
    return {
        StyleSheet: { hairlineWidth: 1, create: (factory: unknown) => typeof factory === 'function' ? (factory as (value: typeof mockTheme) => object)(mockTheme) : factory },
        useUnistyles: () => ({ theme: mockTheme }),
    };
});
const now = 1_000_000;
const current = {
    sampledAt: now,
    cpuUsedPercent: 25,
    cpuCores: 10,
    load1: 1,
    load5: 1,
    load15: 1,
    memoryTotalBytes: 16 * 1024 ** 3,
    memoryAvailableBytes: 8 * 1024 ** 3,
    memoryCompressedBytes: 1 * 1024 ** 3,
    swapUsedBytes: 1 * 1024 ** 3,
    swapTotalBytes: 4 * 1024 ** 3,
    processCount: 500,
    processLimit: 4_000,
    zombieProcessCount: 2,
    pawsWorkerRoots: 1,
    pawsWorkerProcesses: 2,
    pawsWorkerRssBytes: 100,
    orphanWorkerRoots: 0,
    orphanWorkerProcesses: 0,
    orphanWorkerRssBytes: 0,
    topCpuSources: [{ id: 'sample', name: 'Sample', cpuPercent: 20, rssBytes: 100, processCount: 2, zombieProcessCount: 2 }],
    topMemorySources: [],
    topZombieSources: [{ id: 'sample', name: 'Sample', cpuPercent: 20, rssBytes: 100, processCount: 2, zombieProcessCount: 2 }],
};
const point = {
    sampledAt: now,
    cpuUsedPercent: 25,
    load1: 1,
    memoryAvailableBytes: 8 * 1024 ** 3,
    swapUsedBytes: 1 * 1024 ** 3,
    processCount: 500,
    zombieProcessCount: 2,
    orphanWorkerRoots: 0,
    pawsWorkerRssBytes: 100,
};

function machine(overrides: Partial<Machine> = {}): Machine {
    return {
        id: 'mac', seq: 1, createdAt: 0, updatedAt: 0, active: true, activeAt: now,
        metadataVersion: 1, daemonStateVersion: 1,
        metadata: { host: 'mac', platform: 'darwin', happyCliVersion: '1', homeDir: '/tmp', happyHomeDir: '/tmp', systemHealthMonitor: { schemaVersion: 1, supported: true, enabled: true, reportedAt: now } },
        daemonState: { systemHealth: { schemaVersion: 1, platform: 'darwin', updatedAt: now, lastAttemptAt: now, resourceStatus: 'warning', current, history: [point], issues: [{ code: 'zombie-processes', severity: 'warning', observed: 2, threshold: 1, unit: 'count', since: now }], collector: { intervalSeconds: 15, historyStepSeconds: 60, durationMs: 10, lastSampleKind: 'complete', errors: [] } } },
        ...overrides,
    };
}

function chart(points: Array<{ sampledAt: number; value: number }>): SystemHealthChartModel {
    const values = points.map((item) => item.value).filter(Number.isFinite);
    return {
        key: 'cpuUsedPercent',
        labelKey: 'machine.systemHealth.metrics.cpu',
        unit: 'percent',
        points,
        latest: values.at(-1) ?? null,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
        accessibilitySummary: { labelKey: 'machine.systemHealth.metrics.cpu', summaryKey: 'machine.systemHealth.chartSummary', latest: values.at(-1) ?? null, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null },
    };
}

describe('SystemHealthSection', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        errorSpy.mockRestore();
        vi.doUnmock('@/components/systemHealth/SystemHealthSection');
        vi.useRealTimers();
        pageTestState.online = true;
    });

    it('provides localized system-health copy for every supported locale', () => {
        expect(ca.machine.systemHealth.title).toBe('Estat del sistema');
        expect(english.machine.systemHealth.title).toBe('System Health');
        expect(es.machine.systemHealth.title).toBe('Estado del sistema');
        expect(italian.machine.systemHealth.title).toBe('Stato del sistema');
        expect(ja.machine.systemHealth.title).toBe('システムの状態');
        expect(pl.machine.systemHealth.title).toBe('Stan systemu');
        expect(pt.machine.systemHealth.title).toBe('Estado do sistema');
        expect(ru.machine.systemHealth.title).toBe('Состояние системы');
        expect(zhHans.machine.systemHealth.title).toBe('系统稳定性');
        expect(zhHant.machine.systemHealth.title).toBe('系統穩定性');
    });

    it('renders five trend series, resource sources and an accessible status', () => {
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<SystemHealthSection machine={machine()} now={now} />); });
        expect(renderer.root.findAllByProps({ testID: 'system-health-sparkline' })).toHaveLength(5);
        expect(renderer.root.findByProps({ testID: 'system-health-status' }).props.accessibilityLabel).toEqual(expect.any(String));
        expect(JSON.stringify(renderer.toJSON())).toContain('Sample');
        act(() => renderer.unmount());
    });

    it('does not render on non-macOS machines and distinguishes disabled capability', () => {
        let hidden: any;
        act(() => { hidden = TestRenderer.create(<SystemHealthSection machine={machine({ metadata: { ...machine().metadata!, platform: 'linux' } })} now={now} />); });
        expect(hidden.toJSON()).toBeNull();
        act(() => hidden.unmount());

        let disabled: any;
        act(() => { disabled = TestRenderer.create(<SystemHealthSection machine={machine({ metadata: { ...machine().metadata!, systemHealthMonitor: { schemaVersion: 1, supported: true, enabled: false, reportedAt: now } } })} now={now} />); });
        expect(JSON.stringify(disabled.toJSON())).toContain('HAPPY_SYSTEM_HEALTH_MONITOR=1');
        act(() => disabled.unmount());
    });

    it('keeps Hook order stable when the same renderer becomes a visible macOS section', () => {
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<SystemHealthSection machine={machine({ metadata: { ...machine().metadata!, platform: 'linux' } })} now={now} />); });
        expect(() => act(() => renderer.update(<SystemHealthSection machine={machine()} now={now} />))).not.toThrow();
        expect(renderer.root.findByProps({ testID: 'system-health-section' })).toBeDefined();
        act(() => renderer.unmount());
    });

    it('distinguishes an initial collection attempt and its failure from a passive pending state', () => {
        const firstAttempt = machine({
            daemonState: {
                systemHealth: {
                    ...machine().daemonState.systemHealth,
                    current: null,
                    updatedAt: null,
                    collector: { ...machine().daemonState.systemHealth.collector, lastSampleKind: 'partial' },
                },
            },
        });
        let collecting: any;
        act(() => { collecting = TestRenderer.create(<SystemHealthSection machine={firstAttempt} now={now} />); });
        expect(JSON.stringify(collecting.toJSON())).toContain('machine.systemHealth.empty.collecting');
        act(() => collecting.unmount());

        const failedAttempt = machine({
            daemonState: {
                systemHealth: {
                    ...firstAttempt.daemonState.systemHealth,
                    collector: { ...firstAttempt.daemonState.systemHealth.collector, lastSampleKind: 'failed', errors: [{ command: 'top', code: 'timeout' }] },
                },
            },
        });
        let failed: any;
        act(() => { failed = TestRenderer.create(<SystemHealthSection machine={failedAttempt} now={now} />); });
        expect(JSON.stringify(failed.toJSON())).toContain('machine.systemHealth.empty.unavailable');
        expect(JSON.stringify(failed.toJSON())).toContain('machine.systemHealth.collectorErrors');
        act(() => failed.unmount());
    });

    it('uses the theme warning token and keeps collector diagnostics beside the last complete sample', () => {
        const partial = machine({
            daemonState: {
                systemHealth: {
                    ...machine().daemonState.systemHealth,
                    collector: { ...machine().daemonState.systemHealth.collector, lastSampleKind: 'partial', errors: [{ command: 'top', code: 'timeout' }] },
                },
            },
        });
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<SystemHealthSection machine={partial} now={now} />); });

        const status = renderer.root.findByProps({ testID: 'system-health-status' });
        const statusText = status.findAllByType('Text').find((node: any) => node.props.style?.at(-1)?.color);
        expect(statusText.props.style.at(-1).color).toBe('#f90');
        expect(renderer.root.findByProps({ testID: 'system-health-collector-diagnostic' }).children).toContain('machine.systemHealth.collectorErrors');
        expect(JSON.stringify(renderer.toJSON())).toContain('25.0%');
        act(() => renderer.unmount());
    });

    it('limits resource sources to CPU top three plus unique memory sources', () => {
        const sources = {
            cpu: [
                { id: 'cpu-1', name: 'CPU 1', cpuPercent: 30, rssBytes: 1024 ** 2, processCount: 1, zombieProcessCount: 0 },
                { id: 'cpu-2', name: 'CPU 2', cpuPercent: 20, rssBytes: 1024 ** 2, processCount: 2, zombieProcessCount: 0 },
                { id: 'cpu-3', name: 'CPU 3', cpuPercent: 10, rssBytes: 1024 ** 2, processCount: 3, zombieProcessCount: 0 },
            ],
            memory: [
                { id: 'cpu-2', name: 'Duplicate', cpuPercent: 2, rssBytes: 1024 ** 2, processCount: 2, zombieProcessCount: 0 },
                { id: 'memory-1', name: 'Memory 1', cpuPercent: 1, rssBytes: 2 * 1024 ** 2, processCount: 4, zombieProcessCount: 0 },
                { id: 'memory-2', name: 'Memory 2', cpuPercent: 1, rssBytes: 3 * 1024 ** 2, processCount: 5, zombieProcessCount: 0 },
                { id: 'memory-3', name: 'Memory 3', cpuPercent: 1, rssBytes: 4 * 1024 ** 2, processCount: 6, zombieProcessCount: 0 },
            ],
        };
        const value = machine({
            daemonState: {
                systemHealth: {
                    ...machine().daemonState.systemHealth,
                    current: {
                        ...current,
                        topCpuSources: sources.cpu,
                        topMemorySources: sources.memory,
                        topZombieSources: [{ id: 'zombie', name: 'Must not be an extra resource row', cpuPercent: 0, rssBytes: 0, processCount: 1, zombieProcessCount: 1 }],
                    },
                },
            },
        });
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<SystemHealthSection machine={value} now={now} />); });

        const rows = renderer.root.findAllByProps({ testID: 'system-health-source' });
        const rowText = rows.flatMap((row: any) => row.findAllByType('Text').flatMap((node: any) => React.Children.toArray(node.props.children)));
        expect(rows).toHaveLength(5);
        expect(rowText).toContain('CPU 1');
        expect(rowText).toContain('Memory 2');
        expect(rowText).not.toContain('Memory 3');
        expect(rowText).not.toContain('Must not be an extra resource row');
        act(() => renderer.unmount());
    });

    it('adds no more than two unique memory sources when CPU has fewer than three rows', () => {
        const memory = [
            { id: 'memory-1', name: 'Memory 1', cpuPercent: 1, rssBytes: 1024 ** 2, processCount: 1, zombieProcessCount: 0 },
            { id: 'memory-2', name: 'Memory 2', cpuPercent: 1, rssBytes: 1024 ** 2, processCount: 2, zombieProcessCount: 0 },
            { id: 'memory-3', name: 'Memory 3', cpuPercent: 1, rssBytes: 1024 ** 2, processCount: 3, zombieProcessCount: 0 },
        ];
        const value = machine({
            daemonState: {
                systemHealth: {
                    ...machine().daemonState.systemHealth,
                    current: { ...current, topCpuSources: [{ id: 'cpu-1', name: 'CPU 1', cpuPercent: 30, rssBytes: 1024 ** 2, processCount: 1, zombieProcessCount: 0 }], topMemorySources: memory },
                },
            },
        });
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<SystemHealthSection machine={value} now={now} />); });
        const rows = renderer.root.findAllByProps({ testID: 'system-health-source' });
        const rowText = rows.flatMap((row: any) => row.findAllByType('Text').flatMap((node: any) => React.Children.toArray(node.props.children)));
        expect(rows).toHaveLength(3);
        expect(rowText).toContain('Memory 2');
        expect(rowText).not.toContain('Memory 3');
        act(() => renderer.unmount());
    });

    it('memoizes individual source rows', () => {
        expect(SystemHealthSourceRow.$$typeof).toBe(Symbol.for('react.memo'));
    });

    it('keeps gaps out of trend paths and safely degrades empty, single-point, and constant series', () => {
        let empty: any;
        act(() => { empty = TestRenderer.create(<SystemHealthSparkline chart={chart([])} color="#0f0" />); });
        expect(empty.root.findAllByType('Svg')).toHaveLength(0);
        act(() => empty.unmount());

        let single: any;
        act(() => { single = TestRenderer.create(<SystemHealthSparkline chart={chart([{ sampledAt: 1, value: 2 }])} color="#0f0" timeDomain={[1, 3]} />); });
        act(() => single.root.findAll((node: any) => typeof node.props.onLayout === 'function')[0].props.onLayout({ nativeEvent: { layout: { width: 120 } } }));
        expect(single.root.findAllByType('Circle')).toHaveLength(1);
        expect(single.root.findAllByType('Path')).toHaveLength(0);
        act(() => single.unmount());

        let gapped: any;
        act(() => {
            gapped = TestRenderer.create(<SystemHealthSparkline chart={chart([
                { sampledAt: 1, value: 4 },
                { sampledAt: 2, value: null as any },
                { sampledAt: 3, value: 4 },
                { sampledAt: 4, value: 4 },
            ] as any)} color="#0f0" timeDomain={[1, 4]} />);
        });
        act(() => gapped.root.findAll((node: any) => typeof node.props.onLayout === 'function')[0].props.onLayout({ nativeEvent: { layout: { width: 120 } } }));
        expect(gapped.root.findAllByType('Circle')).toHaveLength(1);
        expect(gapped.root.findByType('Circle').props.cx).toBe(0);
        const path = gapped.root.findByType('Path').props.d;
        expect(path).toMatch(/^M .* L /);
        expect(path).not.toContain('NaN');
        act(() => gapped.unmount());

        let isolated: any;
        act(() => { isolated = TestRenderer.create(<SystemHealthSparkline chart={chart([{ sampledAt: 1, value: 4 }, { sampledAt: 2, value: null as any }, { sampledAt: 3, value: 4 }] as any)} color="#0f0" timeDomain={[1, 3]} />); });
        act(() => isolated.root.findAll((node: any) => typeof node.props.onLayout === 'function')[0].props.onLayout({ nativeEvent: { layout: { width: 120 } } }));
        const circles = isolated.root.findAllByType('Circle');
        expect(circles.map((node: any) => node.props.cx)).toEqual([0, 120]);
        expect(isolated.root.findAllByType('Path')).toHaveLength(0);
        act(() => isolated.unmount());
    });

    it('places the health section after the offline notice and refreshes its local clock every fifteen seconds', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        pageTestState.online = false;
        vi.doMock('@/components/systemHealth/SystemHealthSection', () => ({
            SystemHealthSection: ({ now: sectionNow }: { now: number }) => React.createElement('SystemHealthProbe', { testID: 'system-health-section', healthNow: sectionNow }),
        }));

        const { default: MachineDetailScreen } = await import('../../app/(app)/machine/[id]');
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<MachineDetailScreen />); });

        const section = renderer.root.findByProps({ testID: 'system-health-section' });
        expect(section.props.healthNow).toBe(now);
        const orderedNodes = renderer.root.findAll((node: any) => (
            node.props.testID === 'system-health-section'
            || node.props.testID === 'machine-launch-section'
            || (node.type === 'Item' && node.props.title === 'machine.offlineUnableToSpawn')
        ));
        const order = orderedNodes.map((node: any) => node.props.testID ?? node.props.title);
        expect(order.indexOf('machine.offlineUnableToSpawn')).toBeLessThan(order.indexOf('system-health-section'));
        expect(order.indexOf('system-health-section')).toBeLessThan(order.indexOf('machine-launch-section'));

        act(() => { vi.advanceTimersByTime(15_000); });
        expect(renderer.root.findByProps({ testID: 'system-health-section' }).props.healthNow).toBe(now + 15_000);
        act(() => renderer.unmount());
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
    });
});
