import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error 测试只使用 renderer 的最小接口。
import TestRenderer from 'react-test-renderer';
import { SystemHealthSection } from './SystemHealthSection';
import type { Machine } from '@/sync/storageTypes';

vi.mock('react-native', () => ({ Text: 'Text', View: 'View' }));
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('react-native-unistyles', () => {
    const mockTheme = { colors: { divider: '#222', text: '#fff', textSecondary: '#aaa', warningCritical: '#f00', success: '#0f0' } };
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

describe('SystemHealthSection', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => errorSpy.mockRestore());

    it('renders five trend series, zombie sources and an accessible status', () => {
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
});
