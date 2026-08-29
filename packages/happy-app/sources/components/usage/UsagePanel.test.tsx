import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsagePanel } from './UsagePanel';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    calculateTotals: vi.fn(),
    credentials: { token: 'test' } as { token: string } | null,
    getUsageForPeriod: vi.fn(),
    machines: [] as Array<{ daemonState: unknown }>,
}));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    View: 'View',
}));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            accent: '#00ff88',
            divider: '#333333',
            status: { error: '#ff4757' },
            surface: '#131316',
            text: '#e5e5e7',
            textSecondary: '#6b6b76',
        },
    };
    return {
        StyleSheet: {
            create: (factory: unknown) => typeof factory === 'function'
                ? (factory as (value: typeof theme) => object)(theme)
                : factory,
        },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/auth/AuthContext', () => ({
    useAuth: () => ({ credentials: mocks.credentials }),
}));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => mocks.machines,
}));
vi.mock('@/sync/apiUsage', () => ({
    getUsageForPeriod: mocks.getUsageForPeriod,
    calculateTotals: mocks.calculateTotals,
}));
vi.mock('./UsageChart', () => ({ UsageChart: 'UsageChart' }));
vi.mock('./UsageBar', () => ({ UsageBar: 'UsageBar' }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/utils/errors', () => ({ HappyError: class HappyError extends Error {} }));
vi.mock('@/text', () => ({
    t: (key: string, values?: Record<string, unknown>) => values
        ? `${key}:${JSON.stringify(values)}`
        : key,
}));

const emptyTotals = {
    totalTokens: 0,
    totalCost: 0,
    tokensByModel: {},
    costByModel: {},
};

async function renderUsagePanel() {
    let renderer: any;
    await act(async () => {
        renderer = TestRenderer.create(<UsagePanel />);
    });
    await act(async () => {
        await Promise.resolve();
    });
    return renderer;
}

function textValue(node: { props: { children?: unknown } }): string {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
}

describe('UsagePanel', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mocks.credentials = { token: 'test' };
        mocks.machines = [];
        mocks.getUsageForPeriod.mockReset();
        mocks.calculateTotals.mockReset();
        mocks.calculateTotals.mockReturnValue(emptyTotals);
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('exposes period tabs and renders the localized empty state', async () => {
        mocks.getUsageForPeriod.mockResolvedValue({ usage: [] });
        const renderer = await renderUsagePanel();

        const tablists = renderer.root.findAllByType('View')
            .filter((node: any) => node.props.accessibilityRole === 'tablist');
        const tabs = renderer.root.findAllByType('Pressable')
            .filter((node: any) => node.props.accessibilityRole === 'tab');
        const texts = renderer.root.findAllByType('Text').map(textValue);

        expect(tablists).toHaveLength(1);
        expect(tabs).toHaveLength(3);
        expect(tabs.map((node: any) => node.props['aria-selected'])).toEqual([false, true, false]);
        expect(texts).toContain('usage.noData');

        act(() => renderer.unmount());
    });

    it('uses the same selected-tab semantics for token and cost charts', async () => {
        const usage = [{
            timestamp: 1,
            tokens: { 'test-model': 12 },
            cost: { 'test-model': 0.01 },
            reportCount: 1,
        }];
        mocks.getUsageForPeriod.mockResolvedValue({ usage });
        mocks.calculateTotals.mockReturnValue({
            totalTokens: 12,
            totalCost: 0.01,
            tokensByModel: { 'test-model': 12 },
            costByModel: { 'test-model': 0.01 },
        });
        const renderer = await renderUsagePanel();

        const tablists = renderer.root.findAllByType('View')
            .filter((node: any) => node.props.accessibilityRole === 'tablist');
        const metricTabs = renderer.root.findAllByType('Pressable')
            .filter((node: any) => node.props.accessibilityRole === 'tab')
            .filter((node: any) => {
                const text = node.findAllByType('Text').map(textValue);
                return text.includes('usage.tokens') || text.includes('usage.cost');
            });

        expect(tablists).toHaveLength(2);
        expect(metricTabs.map((node: any) => node.props['aria-selected'])).toEqual([true, false]);

        act(() => metricTabs[1].props.onPress());
        const updatedMetricTabs = renderer.root.findAllByType('Pressable')
            .filter((node: any) => node.props.accessibilityRole === 'tab')
            .filter((node: any) => {
                const text = node.findAllByType('Text').map(textValue);
                return text.includes('usage.tokens') || text.includes('usage.cost');
            });
        expect(updatedMetricTabs.map((node: any) => node.props['aria-selected'])).toEqual([false, true]);

        act(() => renderer.unmount());
    });

    it('ends the initial loading state when credentials are unavailable', async () => {
        mocks.credentials = null;
        const renderer = await renderUsagePanel();
        const texts = renderer.root.findAllByType('Text').map(textValue);

        expect(texts).toContain('Not authenticated');
        expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(0);

        act(() => renderer.unmount());
    });

    it('shows the freshest Codex rate limit with remaining allowance and reset time', async () => {
        mocks.getUsageForPeriod.mockResolvedValue({ usage: [] });
        mocks.machines = [
            {
                daemonState: {
                    codexUsage: {
                        source: 'codex-session-jsonl',
                        scannedAt: 100,
                        latestEvent: {
                            rateLimits: {
                                planType: 'pro',
                                primary: {
                                    usedPercent: 83,
                                    windowMinutes: 10080,
                                    resetsAt: 1_788_452_692,
                                },
                            },
                        },
                    },
                },
            },
            {
                daemonState: {
                    codexUsage: {
                        source: 'codex-session-jsonl',
                        scannedAt: 200,
                        latestEvent: {
                            rateLimits: {
                                planType: 'pro',
                                primary: {
                                    usedPercent: 49,
                                    windowMinutes: 10080,
                                    resetsAt: 1_788_452_692,
                                },
                            },
                        },
                    },
                },
            },
        ];

        const renderer = await renderUsagePanel();
        const rateLimitItem = renderer.root.findAllByType('Item')
            .find((node: any) => node.props.title === 'machine.codexUsageRateLimits');

        expect(rateLimitItem?.props.subtitle).toContain('"used":49');
        expect(rateLimitItem?.props.subtitle).toContain('"remaining":51');
        expect(rateLimitItem?.props.subtitle).toContain('"period":"7d"');

        act(() => renderer.unmount());
    });

    it('ignores an older request that resolves after the latest session request', async () => {
        let resolveFirst!: (value: { usage: unknown[] }) => void;
        let resolveSecond!: (value: { usage: unknown[] }) => void;
        const firstRequest = new Promise<{ usage: unknown[] }>((resolve) => {
            resolveFirst = resolve;
        });
        const secondRequest = new Promise<{ usage: unknown[] }>((resolve) => {
            resolveSecond = resolve;
        });
        mocks.getUsageForPeriod.mockImplementation((_credentials: unknown, _period: unknown, sessionId: string) => (
            sessionId === 'first' ? firstRequest : secondRequest
        ));

        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<UsagePanel sessionId="first" />);
        });
        await act(async () => {
            renderer.update(<UsagePanel sessionId="second" />);
        });

        const latestUsage = [{
            timestamp: 2,
            tokens: { latest: 5 },
            cost: { latest: 0.02 },
            reportCount: 1,
        }];
        await act(async () => {
            resolveSecond({ usage: latestUsage });
            await Promise.resolve();
        });
        expect(renderer.root.findByType('UsageChart').props.data).toEqual(latestUsage);

        const staleUsage = [{
            timestamp: 1,
            tokens: { stale: 9 },
            cost: { stale: 0.09 },
            reportCount: 1,
        }];
        await act(async () => {
            resolveFirst({ usage: staleUsage });
            await Promise.resolve();
        });
        expect(renderer.root.findByType('UsageChart').props.data).toEqual(latestUsage);

        act(() => renderer.unmount());
    });
});
