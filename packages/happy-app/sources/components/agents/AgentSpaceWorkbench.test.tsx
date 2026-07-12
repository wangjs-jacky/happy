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
    launchAgent: vi.fn(),
}));

vi.mock('react-native', () => ({
    Text: 'Text',
    View: 'View',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
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
    useEnterAgentSpace: () => ({ entering: false, enter: mocks.enter }),
}));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./launchAgent', async () => {
    const actual = await vi.importActual<typeof import('./launchAgent')>('./launchAgent');
    return { ...actual, launchAgent: mocks.launchAgent };
});
vi.mock('./builtinAgents', () => ({ getAgentSubtitle: (agent: AgentLauncher) => agent.path }));
vi.mock('@/utils/healthLog', () => ({ isHealthCheckinSession: () => false }));
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

function renderWorkbench(props: { onNavigate: (path: string) => void; onCloseDrawer: () => void }) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <AgentSpaceWorkbench
                agent={agent}
                onExit={vi.fn()}
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
});
