import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSpaceCompanionModel } from './agentSpaceCompanionModel';
import type { AgentLauncher } from './launchAgent';
import { AgentSpaceCompanionPanel } from './AgentSpaceCompanionPanel';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    closePanel: vi.fn(),
    hapticsLight: vi.fn(),
    pan: vi.fn(),
    panelOpen: true,
    reduceMotionHandler: null as ((enabled: boolean) => void) | null,
    removeReduceMotionListener: vi.fn(),
    initialReduceMotion: false,
}));

vi.mock('react-native', () => ({
    AccessibilityInfo: {
        isReduceMotionEnabled: vi.fn(() => Promise.resolve(mocks.initialReduceMotion)),
        addEventListener: vi.fn((_event: string, handler: (enabled: boolean) => void) => {
            mocks.reduceMotionHandler = handler;
            return { remove: mocks.removeReduceMotionListener };
        }),
    },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            surface: '#171717',
            surfaceHigh: '#202020',
            surfaceHighest: '#292929',
            surfacePressed: '#333333',
            text: '#ffffff',
            textSecondary: '#aaaaaa',
            divider: '#444444',
            primary: '#7c5cbf',
        },
    };
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: unknown) => typeof factory === 'function'
                ? (factory as (value: typeof theme) => object)(theme)
                : factory,
        },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({
    t: (key: string, values?: { current?: number; total?: number; title?: string }) => {
        if (key.endsWith('paginationAccessibility')) return `Tip ${values?.current} of ${values?.total}`;
        if (key.endsWith('actionAccessibility')) return `Use quick action: ${values?.title}`;
        return key;
    },
}));
vi.mock('../haptics', () => ({ hapticsLight: mocks.hapticsLight }));
vi.mock('../RightSwipePanelHost', () => ({
    useRightSwipePanel: () => mocks.closePanel ? { closePanel: mocks.closePanel, isOpen: mocks.panelOpen, registerBackHandler: vi.fn() } : null,
}));
vi.mock('react-native-gesture-handler', () => ({ Gesture: { Pan: mocks.pan } }));

const model: AgentSpaceCompanionModel = {
    title: 'Daily companion',
    subtitle: 'Small steps for a steadier rhythm',
    tips: [
        { id: 'one', eyebrow: 'Tonight', title: 'First tip', body: 'First body' },
        { id: 'two', eyebrow: 'Tomorrow', title: 'Second tip', body: 'Second body' },
        { id: 'three', eyebrow: 'This week', title: 'Third tip', body: 'Third body' },
    ],
    actions: [
        { id: 'sleep', icon: 'weather-night', title: 'Record sleep', prompt: 'Sleep prompt' },
        { id: 'exercise', icon: 'run', title: 'Record exercise', prompt: 'Exercise prompt' },
    ],
};

const agent: Pick<AgentLauncher, 'name' | 'glyph' | 'color'> = {
    name: 'Health Agent',
    glyph: 'H',
    color: '#0F766E',
};

function textValue(node: { props: { children?: unknown } }): string {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
}

function hasText(root: any, value: string): boolean {
    return root.findAllByType('Text').some((node: any) => textValue(node) === value);
}

function flattenStyle(style: unknown): Record<string, unknown> {
    if (typeof style === 'function') return flattenStyle(style({ pressed: false }));
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
    return style && typeof style === 'object' ? style as Record<string, unknown> : {};
}

function renderPanel(onInsertPrompt = vi.fn(), overrideModel = model) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <AgentSpaceCompanionPanel
                agent={agent}
                model={overrideModel}
                onInsertPrompt={onInsertPrompt}
            />,
        );
    });
    return renderer;
}

async function resolveInitialReduceMotion() {
    await act(async () => {
        await Promise.resolve();
    });
}

describe('AgentSpaceCompanionPanel', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.initialReduceMotion = false;
        mocks.panelOpen = true;
        mocks.reduceMotionHandler = null;
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        vi.useRealTimers();
    });

    it('renders Agent identity, panel heading, and the first tip initially', () => {
        const renderer = renderPanel();

        expect(hasText(renderer.root, 'Health Agent')).toBe(true);
        expect(hasText(renderer.root, 'H')).toBe(true);
        expect(hasText(renderer.root, 'Daily companion')).toBe(true);
        expect(hasText(renderer.root, 'First tip')).toBe(true);
        expect(hasText(renderer.root, 'Second tip')).toBe(false);

        act(() => renderer.unmount());
    });

    it('waits for reduce-motion resolution, then rotates once at exactly 8000ms', async () => {
        const renderer = renderPanel();
        expect(vi.getTimerCount()).toBe(0);

        await resolveInitialReduceMotion();
        expect(vi.getTimerCount()).toBe(1);
        act(() => vi.advanceTimersByTime(7_999));
        expect(hasText(renderer.root, 'First tip')).toBe(true);
        act(() => vi.advanceTimersByTime(1));
        expect(hasText(renderer.root, 'Second tip')).toBe(true);

        act(() => renderer.unmount());
    });

    it('does not rotate or start a timer while the panel is closed', async () => {
        mocks.panelOpen = false;
        const renderer = renderPanel();

        await resolveInitialReduceMotion();
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(16_000));
        expect(hasText(renderer.root, 'First tip')).toBe(true);

        act(() => renderer.unmount());
    });

    it('starts a fresh 8000ms interval from Tip 1 when the panel opens', async () => {
        mocks.panelOpen = false;
        const onInsertPrompt = vi.fn();
        const renderer = renderPanel(onInsertPrompt);
        await resolveInitialReduceMotion();
        act(() => vi.advanceTimersByTime(16_000));

        mocks.panelOpen = true;
        act(() => renderer.update(
            <AgentSpaceCompanionPanel agent={agent} model={model} onInsertPrompt={vi.fn()} />,
        ));
        expect(hasText(renderer.root, 'First tip')).toBe(true);
        expect(vi.getTimerCount()).toBe(1);
        act(() => vi.advanceTimersByTime(7_999));
        expect(hasText(renderer.root, 'First tip')).toBe(true);
        act(() => vi.advanceTimersByTime(1));
        expect(hasText(renderer.root, 'Second tip')).toBe(true);

        act(() => renderer.unmount());
    });

    it('selects a pagination page and permanently pauses rotation for the mount', async () => {
        const renderer = renderPanel();
        await resolveInitialReduceMotion();
        const thirdPage = renderer.root.findByProps({ accessibilityLabel: 'Tip 3 of 3' });

        act(() => thirdPage.props.onPress());
        expect(hasText(renderer.root, 'Third tip')).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(24_000));
        expect(hasText(renderer.root, 'Third tip')).toBe(true);

        act(() => renderer.unmount());
    });

    it('keeps auto-rotation off when initial reduce motion is enabled', async () => {
        mocks.initialReduceMotion = true;
        const renderer = renderPanel();

        await resolveInitialReduceMotion();
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(8_000));
        expect(hasText(renderer.root, 'First tip')).toBe(true);

        act(() => renderer.unmount());
    });

    it('stops and restarts an eligible timer when reduce motion changes at runtime', async () => {
        const renderer = renderPanel();
        await resolveInitialReduceMotion();
        expect(vi.getTimerCount()).toBe(1);

        act(() => mocks.reduceMotionHandler?.(true));
        expect(vi.getTimerCount()).toBe(0);
        act(() => mocks.reduceMotionHandler?.(false));
        expect(vi.getTimerCount()).toBe(1);
        act(() => vi.advanceTimersByTime(8_000));
        expect(hasText(renderer.root, 'Second tip')).toBe(true);

        act(() => renderer.unmount());
    });

    it('removes the reduce-motion listener and active timer on unmount', async () => {
        const renderer = renderPanel();
        await resolveInitialReduceMotion();
        expect(vi.getTimerCount()).toBe(1);

        act(() => renderer.unmount());

        expect(mocks.removeReduceMotionListener).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('exposes selected state, readable button labels, and at least 44dp targets', async () => {
        const renderer = renderPanel();
        await resolveInitialReduceMotion();
        const firstPage = renderer.root.findByProps({ accessibilityLabel: 'Tip 1 of 3' });
        const secondPage = renderer.root.findByProps({ accessibilityLabel: 'Tip 2 of 3' });
        const action = renderer.root.findByProps({ accessibilityLabel: 'Use quick action: Record sleep' });

        expect(firstPage.props.accessibilityRole).toBe('button');
        expect(firstPage.props.accessibilityState).toEqual({ selected: true });
        expect(secondPage.props.accessibilityState).toEqual({ selected: false });
        expect(action.props.accessibilityRole).toBe('button');
        const pageStyle = flattenStyle(firstPage.props.style);
        const actionStyle = flattenStyle(action.props.style);
        expect(pageStyle.minWidth).toBeGreaterThanOrEqual(44);
        expect(pageStyle.minHeight).toBeGreaterThanOrEqual(44);
        expect(actionStyle.minWidth).toBeGreaterThanOrEqual(44);
        expect(actionStyle.minHeight).toBeGreaterThanOrEqual(44);

        act(() => renderer.unmount());
    });

    it('haptics first, closes the panel, and inserts only from the close callback', () => {
        const onInsertPrompt = vi.fn();
        const renderer = renderPanel(onInsertPrompt);
        const action = renderer.root.findByProps({ accessibilityLabel: 'Use quick action: Record sleep' });

        act(() => action.props.onPress());

        expect(mocks.hapticsLight).toHaveBeenCalledTimes(1);
        expect(mocks.closePanel).toHaveBeenCalledTimes(1);
        expect(onInsertPrompt).not.toHaveBeenCalled();
        const onClosed = mocks.closePanel.mock.calls[0][0];
        act(() => onClosed());
        expect(onInsertPrompt).toHaveBeenCalledWith('Sleep prompt');

        act(() => renderer.unmount());
    });

    it('does not insert when rendered outside the panel context', async () => {
        const onInsertPrompt = vi.fn();
        const closePanel = mocks.closePanel;
        // The module mock maps a falsy closePanel to an unavailable context.
        (mocks as { closePanel: typeof mocks.closePanel | null }).closePanel = null;
        const renderer = renderPanel(onInsertPrompt);
        await resolveInitialReduceMotion();
        const action = renderer.root.findByProps({ accessibilityLabel: 'Use quick action: Record sleep' });

        expect(() => act(() => action.props.onPress())).not.toThrow();
        expect(mocks.hapticsLight).toHaveBeenCalledTimes(1);
        expect(onInsertPrompt).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        act(() => renderer.unmount());
        (mocks as { closePanel: typeof closePanel | null }).closePanel = closePanel;
    });

    it('omits the Tip hero for a model with no tips and never registers a Pan gesture', () => {
        const renderer = renderPanel(vi.fn(), { ...model, tips: [] });

        expect(hasText(renderer.root, 'First tip')).toBe(false);
        expect(mocks.pan).not.toHaveBeenCalled();

        act(() => renderer.unmount());
    });
});
