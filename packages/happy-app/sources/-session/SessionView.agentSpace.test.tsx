import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLauncher } from '@/components/agents/launchAgent';
import {
    AgentSpaceExitButton,
    SessionRightPanelContent,
} from '@/components/agents/SessionAgentSpaceBoundary';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    closePanel: vi.fn(),
    pendingCloseCallback: null as (() => void) | null,
}));

vi.mock('react-native', () => ({
    AccessibilityInfo: {
        isReduceMotionEnabled: vi.fn(() => new Promise<boolean>(() => {})),
        addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' }));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            accent: '#7c5cbf',
            divider: '#444444',
            surfaceHigh: '#202020',
            surfacePressed: '#333333',
            text: '#ffffff',
            textSecondary: '#aaaaaa',
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
vi.mock('@/components/haptics', () => ({ hapticsLight: vi.fn() }));
vi.mock('@/components/rightPanel/SessionCapabilityHub', () => ({ SessionCapabilityHub: 'SessionCapabilityHub' }));
vi.mock('@/components/RightSwipePanelHost', () => ({
    useRightSwipePanel: () => ({
        isOpen: true,
        closePanel: (callback?: () => void) => {
            mocks.closePanel(callback);
            mocks.pendingCloseCallback = callback ?? null;
        },
        registerBackHandler: vi.fn(),
    }),
}));
vi.mock('@/text', () => ({
    t: (key: string, values?: { current?: number; total?: number; title?: string }) => {
        if (key === 'agentSpace.exit') return 'Exit space';
        if (key.endsWith('paginationAccessibility')) return `Tip ${values?.current} of ${values?.total}`;
        if (key.endsWith('actionAccessibility')) return `Use quick action: ${values?.title}`;
        return key;
    },
}));

function makeAgent(overrides: Partial<AgentLauncher> = {}): AgentLauncher {
    return {
        id: 'health-agent',
        name: 'Health Agent',
        glyph: 'H',
        color: '#0F766E',
        machineId: 'm1',
        path: '~/health',
        presets: [],
        kind: 'standard',
        spaceType: 'health',
        imageStyleIds: [],
        imageVariantsPerStyle: 1,
        ...overrides,
    };
}

describe('SessionView Agent-space boundary', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pendingCloseCallback = null;
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('resolves a matched Agent to companion content and an ordinary session to the capability hub', () => {
        const agent = makeAgent();
        const composerHandleRef = { current: { setMessage: vi.fn() } };
        let matched: any;
        let ordinary: any;

        act(() => {
            matched = TestRenderer.create(
                <SessionRightPanelContent
                    composerHandleRef={composerHandleRef}
                    sessionId="session-1"
                    spaceAgent={agent}
                />,
            );
            ordinary = TestRenderer.create(
                <SessionRightPanelContent
                    composerHandleRef={composerHandleRef}
                    sessionId="session-1"
                    spaceAgent={null}
                />,
            );
        });

        expect(matched.root.findAllByType('ScrollView')).toHaveLength(1);
        expect(matched.root.findAllByProps({
            accessibilityLabel: 'Use quick action: agentSpace.companion.actionSleepTitle',
        })).toHaveLength(1);
        expect(matched.root.findAllByType('SessionCapabilityHub')).toHaveLength(0);
        expect(ordinary.root.findAllByType('SessionCapabilityHub')).toHaveLength(1);

        act(() => {
            matched.unmount();
            ordinary.unmount();
        });
    });

    it('hands a companion action to the composer owner only after panel close completion', () => {
        const composer = { setMessage: vi.fn() };
        let renderer: any;

        act(() => {
            renderer = TestRenderer.create(
                <SessionRightPanelContent
                    composerHandleRef={{ current: composer }}
                    sessionId="session-1"
                    spaceAgent={makeAgent()}
                />,
            );
        });
        const action = renderer.root.findByProps({
            accessibilityLabel: 'Use quick action: agentSpace.companion.actionSleepTitle',
        });

        act(() => action.props.onPress());
        expect(mocks.closePanel).toHaveBeenCalledTimes(1);
        expect(mocks.pendingCloseCallback).toEqual(expect.any(Function));
        expect(composer.setMessage).not.toHaveBeenCalled();

        act(() => mocks.pendingCloseCallback?.());
        expect(composer.setMessage).toHaveBeenCalledWith('agentSpace.companion.actionSleepPrompt');

        act(() => renderer.unmount());
    });

    it('renders a localized Agent-space exit button and forwards its action', () => {
        const onPress = vi.fn();
        let renderer: any;

        act(() => {
            renderer = TestRenderer.create(
                <AgentSpaceExitButton color="#FFFFFF" onPress={onPress} />,
            );
        });
        const exitButton = renderer.root.findByProps({ accessibilityLabel: 'Exit space' });

        expect(exitButton.props.accessibilityRole).toBe('button');
        act(() => exitButton.props.onPress());
        expect(onPress).toHaveBeenCalledTimes(1);

        act(() => renderer.unmount());
    });
});
