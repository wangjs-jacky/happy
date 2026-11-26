import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexActivityHeatmap } from './CodexActivityHeatmap.tsx';
import type { ActivityDay, ActivitySnapshot } from './codexActivityCalendar';
import { appThemes } from '@/themePacks';
import { multiplyColorOpacity } from '@/utils/colorOpacity';

// @ts-expect-error react-test-renderer does not include its TypeScript declarations.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({ scrollToEnd: vi.fn() }));

vi.mock('react-native', () => ({
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    View: 'View',
    Platform: { OS: 'android', select: (values: Record<string, unknown>) => values.android ?? values.native ?? values.default },
}));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('react-native-unistyles', async () => {
    const { appThemes } = await vi.importActual<typeof import('@/themePacks')>('@/themePacks');
    const theme = appThemes.ginghamDark;
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: (value: typeof theme) => object) => factory(theme),
        },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/text', () => ({
    t: (key: string, values?: Record<string, unknown>) => values
        ? `${key}:${JSON.stringify(values)}`
        : key,
}));

const day = (date: string, totalTokens: number, cachedInputTokens = 0): ActivityDay => ({
    date,
    inputTokens: totalTokens - 50,
    cachedInputTokens,
    outputTokens: 50,
    reasoningOutputTokens: 20,
    totalTokens,
    tokenCountEvents: 1,
    sessions: 2,
    totalOnlyTokens: 0,
});

function snapshot(days: ActivityDay[]): ActivitySnapshot {
    return {
        source: 'codex-session-jsonl',
        scannedAt: Date.parse('2026-11-25T11:00:00.000Z'),
        timeZone: 'Asia/Shanghai',
        days,
    };
}

async function render(snapshotValue: ActivitySnapshot | null) {
    let renderer: any;
    await act(async () => {
        renderer = TestRenderer.create(<CodexActivityHeatmap snapshot={snapshotValue} language="zh-Hans" />, {
            createNodeMock: (element: { props: { testID?: string } }) => (
                element.props.testID === 'codex-usage-heatmap-scroll'
                    ? { scrollToEnd: mocks.scrollToEnd }
                    : null
            ),
        });
    });
    return renderer;
}

function flattenStyle(value: unknown): Record<string, unknown> {
    if (Array.isArray(value)) return Object.assign({}, ...value.map(flattenStyle));
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

describe('native Codex activity heatmap', () => {
    const renderers: any[] = [];
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    const originalError = console.error;

    beforeEach(() => {
        mocks.scrollToEnd.mockReset();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalError(...values);
        });
    });

    afterEach(() => {
        renderers.splice(0).forEach(renderer => act(() => renderer.unmount()));
        consoleErrorSpy.mockRestore();
    });

    it('keeps the entire annual calendar reachable on native, with exact accessible totals', async () => {
        const renderer = await render(snapshot([day('2026-11-25', 1_250_050, 1_000_000)]));
        renderers.push(renderer);
        const cells = renderer.root.findAllByType('Pressable')
            .filter((node: any) => node.props.testID?.startsWith('codex-usage-day-'));

        expect(cells).toHaveLength(365);
        expect(renderer.root.findByProps({ testID: 'codex-usage-day-2025-11-26' })).toBeDefined();
        const today = renderer.root.findByProps({ testID: 'codex-usage-day-2026-11-25' });
        expect(today.props.accessibilityLabel).toContain('1,250,050');
        expect(today.props.accessibilityState.selected).toBe(true);
        expect(flattenStyle(today.props.style).backgroundColor).toBe(multiplyColorOpacity(appThemes.ginghamDark.colors.accent, 1));
        expect(renderer.root.findByProps({ testID: 'codex-activity-detail-toggle' }).props.accessibilityState.expanded).toBe(false);
        expect(renderer.root.findAllByProps({ testID: 'codex-activity-breakdown' })).toHaveLength(0);
    });

    it('preserves the heat color when selecting a day and reveals cache without double-counting', async () => {
        const renderer = await render(snapshot([
            day('2026-11-24', 1_000, 850),
            day('2026-11-25', 2_000, 1_000),
        ]));
        renderers.push(renderer);
        let cell = renderer.root.findByProps({ testID: 'codex-usage-day-2026-11-24' });
        const heatColor = flattenStyle(cell.props.style).backgroundColor;

        act(() => cell.props.onPress());
        cell = renderer.root.findByProps({ testID: 'codex-usage-day-2026-11-24' });
        expect(cell.props.accessibilityState.selected).toBe(true);
        expect(flattenStyle(cell.props.style).backgroundColor).toBe(heatColor);
        expect(flattenStyle(cell.props.style).backgroundColor).not.toBe(appThemes.ginghamDark.colors.surfaceSelected);
        const toggle = renderer.root.findByProps({ testID: 'codex-activity-detail-toggle' });
        expect(toggle.props.accessibilityLabel).toContain('2026-11-24');
        act(() => toggle.props.onPress());

        expect(renderer.root.findByProps({ testID: 'codex-activity-metric-total' }).props.accessibilityLabel).toContain('1,000');
        expect(renderer.root.findByProps({ testID: 'codex-activity-metric-uncached-input' }).props.accessibilityLabel).toContain('100');
        expect(renderer.root.findByProps({ testID: 'codex-activity-metric-cache-read' }).props.accessibilityLabel).toContain('850');
        expect(renderer.root.findByProps({ testID: 'codex-activity-metric-output' }).props.accessibilityLabel).toContain('50');
        expect(renderer.root.findAllByProps({ testID: 'codex-activity-breakdown' })).toHaveLength(1);
        act(() => renderer.root.findByProps({ testID: 'codex-activity-detail-toggle' }).props.onPress());
        expect(renderer.root.findAllByProps({ testID: 'codex-activity-breakdown' })).toHaveLength(0);
    });

    it('only locates the latest dates once and preserves a chosen day on snapshot updates', async () => {
        const renderer = await render(snapshot([day('2026-11-24', 1_000), day('2026-11-25', 2_000)]));
        renderers.push(renderer);
        let scroll = renderer.root.findByProps({ testID: 'codex-usage-heatmap-scroll' });
        act(() => {
            scroll.props.onLayout({ nativeEvent: { layout: { width: 280 } } });
            scroll.props.onContentSizeChange(850, 140);
        });
        expect(mocks.scrollToEnd).toHaveBeenCalledTimes(1);
        act(() => renderer.root.findByProps({ testID: 'codex-usage-day-2026-11-24' }).props.onPress());
        await act(async () => renderer.update(
            <CodexActivityHeatmap snapshot={snapshot([day('2026-11-24', 1_100), day('2026-11-25', 3_000)])} language="zh-Hans" />,
        ));
        scroll = renderer.root.findByProps({ testID: 'codex-usage-heatmap-scroll' });
        act(() => {
            scroll.props.onLayout({ nativeEvent: { layout: { width: 330 } } });
            scroll.props.onContentSizeChange(850, 140);
        });
        expect(mocks.scrollToEnd).toHaveBeenCalledTimes(1);
        expect(renderer.root.findByProps({ testID: 'codex-usage-day-2026-11-24' }).props.accessibilityState.selected).toBe(true);
    });

    it('keeps missing snapshots distinct from a valid empty year', async () => {
        const missing = await render(null);
        renderers.push(missing);
        expect(missing.toJSON()).toBe(null);
        const empty = await render(snapshot([]));
        renderers.push(empty);
        expect(empty.root.findAllByType('Text').some((node: any) => node.props.children === 'codexActivity.noActivity')).toBe(true);
        expect(empty.root.findAllByType('Pressable').filter((node: any) => node.props.testID?.startsWith('codex-usage-day-'))).toHaveLength(365);
    });
});
