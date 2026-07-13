import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLauncher } from './launchAgent';
import { AgentSpaceWorkbench } from './AgentSpaceWorkbench';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    enter: vi.fn(),
    hapticsLight: vi.fn(),
    launchAgent: vi.fn(),
    entering: false,
}));

vi.mock('react-native', () => ({
    Platform: { OS: 'android' },
    Text: 'Text',
    View: 'View',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/components/haptics', () => ({ hapticsLight: mocks.hapticsLight }));
vi.mock('@/components/SessionActionsPopover', () => ({ SessionActionsPopover: 'SessionActionsPopover' }));
vi.mock('react-native-unistyles', () => {
    const mockTheme = {
        colors: {
            surface: '#fff', surfacePressed: '#eee', text: '#111', textSecondary: '#666', divider: '#ddd',
            status: { connected: '#0a0', disconnected: '#a00' },
        },
    };
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: unknown) => typeof factory === 'function'
                ? (factory as (value: typeof mockTheme) => object)(mockTheme)
                : factory,
        },
        useUnistyles: () => ({ theme: mockTheme }),
    };
});
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => [{ id: 'machine-1', metadata: { host: 'mac' } }],
    useAgentSpaceSessions: () => [{ id: 'history-1', name: 'Historical session', subtitle: 'Earlier', active: false }],
}));
vi.mock('@/hooks/useNewSessionDraft', () => ({ useNewSessionDraft: () => ({}) }));
vi.mock('@/hooks/useEnterAgentSpace', () => ({
    useEnterAgentSpace: () => ({ entering: mocks.entering, enter: mocks.enter }),
}));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./launchAgent', async () => {
    const actual = await vi.importActual<typeof import('./launchAgent')>('./launchAgent');
    return { ...actual, launchAgent: mocks.launchAgent };
});
vi.mock('./builtinAgents', () => ({ getAgentSubtitle: (agent: AgentLauncher) => agent.path }));
vi.mock('@/utils/healthLog', () => ({
    isHealthCheckinSession: (path: string) => path.includes('健康打卡'),
}));
vi.mock('./AgentSpaceHealthPanel', () => ({ AgentSpaceHealthPanel: 'AgentSpaceHealthPanel' }));

const agent: AgentLauncher = {
    id: 'agent-1',
    name: 'Agent',
    glyph: 'A',
    color: '#5e5791',
    machineId: 'machine-1',
    path: '~/work',
    kind: 'standard',
    spaceType: 'default',
    imageStyleIds: [],
    imageVariantsPerStyle: 1,
    presets: [{ label: 'Run preset', prompt: 'Preset prompt' }],
};

function textValue(node: { props: { children?: unknown } }): string {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
}

function findPressableByText(root: any, label: string) {
    return root.findAllByType('Pressable').find((node: any) => (
        node.findAllByType('Text').some((text: any) => textValue(text) === label)
    ));
}

function renderWorkbench(props: {
    onNavigate: (path: string) => void;
    onCloseDrawer: () => void;
    onExit?: () => void;
    agent?: AgentLauncher;
}) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <AgentSpaceWorkbench
                agent={props.agent ?? agent}
                onExit={props.onExit ?? vi.fn()}
                onNavigate={props.onNavigate}
                onCloseDrawer={props.onCloseDrawer}
            />,
        );
    });
    return renderer;
}

describe('AgentSpaceWorkbench', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.entering = false;
        mocks.enter.mockResolvedValue({ type: 'success', sessionId: 'session-1' });
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('starts a new blank session through the coordinator and closes only the drawer', async () => {
        const onCloseDrawer = vi.fn();
        const renderer = renderWorkbench({ onNavigate: vi.fn(), onCloseDrawer });

        await act(async () => {
            await findPressableByText(renderer.root, 'agentSpace.newSession').props.onPress();
        });

        expect(mocks.enter).toHaveBeenCalledWith(agent, { beforeNavigate: onCloseDrawer });
        expect(mocks.launchAgent).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('stores preset text as the new session draft without routing through /new', async () => {
        const onCloseDrawer = vi.fn();
        const onNavigate = vi.fn();
        const renderer = renderWorkbench({ onNavigate, onCloseDrawer });

        await act(async () => {
            await findPressableByText(renderer.root, 'Run preset').props.onPress();
        });

        expect(mocks.enter).toHaveBeenCalledWith(agent, {
            initialDraft: 'Preset prompt',
            beforeNavigate: onCloseDrawer,
        });
        expect(mocks.launchAgent).not.toHaveBeenCalled();
        expect(onNavigate).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('keeps historical rows on direct session navigation', () => {
        const onNavigate = vi.fn();
        const renderer = renderWorkbench({ onNavigate, onCloseDrawer: vi.fn() });

        act(() => findPressableByText(renderer.root, 'Historical session').props.onPress());

        expect(onNavigate).toHaveBeenCalledWith('/session/history-1');
        expect(mocks.enter).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('opens the existing session actions popover from a native long press', () => {
        const renderer = renderWorkbench({ onNavigate: vi.fn(), onCloseDrawer: vi.fn() });
        const history = findPressableByText(renderer.root, 'Historical session');

        expect(history.props.onLongPress).toEqual(expect.any(Function));
        act(() => history.props.onLongPress({ nativeEvent: { pageX: 120, pageY: 240 } }));

        expect(mocks.hapticsLight).toHaveBeenCalledOnce();
        const popover = renderer.root.findByType('SessionActionsPopover');
        expect(popover.props).toMatchObject({
            anchor: { type: 'point', x: 120, y: 240 },
            sessionId: 'history-1',
            visible: true,
        });
        act(() => renderer.unmount());
    });

    it('guards exit, history, new, and preset actions while entering', () => {
        mocks.entering = true;
        const onExit = vi.fn();
        const onNavigate = vi.fn();
        const renderer = renderWorkbench({ onExit, onNavigate, onCloseDrawer: vi.fn() });
        const exit = findPressableByText(renderer.root, 'agentSpace.exit');
        const history = findPressableByText(renderer.root, 'Historical session');
        const preset = findPressableByText(renderer.root, 'Run preset');
        const create = findPressableByText(renderer.root, 'agentSpace.entering');

        expect(exit.props.disabled).toBe(true);
        expect(history.props.disabled).toBe(true);
        expect(preset.props.disabled).toBe(true);
        expect(create.props.disabled).toBe(true);
        act(() => {
            exit.props.onPress();
            history.props.onPress();
        });
        expect(onExit).not.toHaveBeenCalled();
        expect(onNavigate).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('keeps image-style new sessions on the /new compose flow', async () => {
        const imageAgent: AgentLauncher = {
            ...agent,
            id: 'image-agent',
            kind: 'image-styles',
            imageStyleIds: ['style-1'],
        };
        const onNavigate = vi.fn();
        const renderer = renderWorkbench({ agent: imageAgent, onNavigate, onCloseDrawer: vi.fn() });

        await act(async () => {
            await findPressableByText(renderer.root, 'agentSpace.newSession').props.onPress();
        });

        expect(mocks.launchAgent).toHaveBeenCalledWith(imageAgent, expect.any(Object), onNavigate, undefined);
        expect(mocks.enter).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('shows the health report for a renamed health space', () => {
        const healthAgent: AgentLauncher = {
            ...agent,
            path: '~/renamed-space',
            spaceType: 'health',
        };
        const renderer = renderWorkbench({
            agent: healthAgent,
            onNavigate: vi.fn(),
            onCloseDrawer: vi.fn(),
        });

        expect(renderer.root.findAllByType('AgentSpaceHealthPanel')).toHaveLength(1);
        expect(findPressableByText(renderer.root, 'agentSpace.tabHealth')).toBeDefined();
        act(() => renderer.unmount());
    });

    it('does not show the health report for a default space with a health-like path', () => {
        const defaultAgent: AgentLauncher = {
            ...agent,
            path: '~/健康打卡',
            spaceType: 'default',
        };
        const renderer = renderWorkbench({
            agent: defaultAgent,
            onNavigate: vi.fn(),
            onCloseDrawer: vi.fn(),
        });

        expect(renderer.root.findAllByType('AgentSpaceHealthPanel')).toHaveLength(0);
        expect(findPressableByText(renderer.root, 'agentSpace.tabHealth')).toBeUndefined();
        act(() => renderer.unmount());
    });
});
