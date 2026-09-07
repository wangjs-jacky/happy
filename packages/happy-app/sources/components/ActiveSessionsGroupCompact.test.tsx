import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer does not publish declarations.
import TestRenderer from 'react-test-renderer';
import { ActiveSessionsGroupCompact } from './ActiveSessionsGroupCompact';

const mocks = vi.hoisted(() => {
    (globalThis as any).__DEV__ = false;
    const state = {
        expansion: {} as Record<string, boolean>,
        renderExpansion: null as null | ((next: Record<string, boolean>) => void),
        setExpansion: vi.fn(),
    };
    return Object.assign(state, {
        updateExpansion(updater: (current: Record<string, boolean>) => Record<string, boolean>) {
            const next = updater(state.expansion);
            state.expansion = next;
            state.setExpansion(next);
            state.renderExpansion?.(next);
        },
    });
});

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    return {
        Platform: { OS: 'web', select: ({ default: value }: any) => value },
        Pressable: ({ children, ...props }: any) => ReactModule.createElement(
            'Pressable',
            props,
            typeof children === 'function' ? children({ pressed: false }) : children,
        ),
        View: 'View',
        useWindowDimensions: () => ({ width: 1024, height: 768 }),
    };
});
vi.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ canDismiss: () => false, navigate: vi.fn() }) }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        hairlineWidth: 1,
        create: (factory: any) => factory({ colors: {
            accent: '#08f', divider: '#333', groupped: { background: '#111', sectionTitle: '#777' },
            radio: { active: '#08f' }, shadow: { color: '#000', opacity: 0.2 },
            surface: '#222', surfaceHigh: '#333', surfacePressed: '#444', surfaceSelected: '#555',
            text: '#fff', textSecondary: '#999', success: '#0a0',
        } }),
    },
    useUnistyles: () => ({ theme: { colors: {
        accent: '#08f', textSecondary: '#999',
    } } }),
}));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/sync/storage', async () => {
    const ReactModule = await import('react');
    return {
        storage: { getState: () => ({ sessionMessages: {} }) },
        useAllMachines: () => [{ id: 'mac', active: true, lastActiveAt: 1, metadata: { displayName: 'Mac', homeDir: '/Users/test' } }],
        useLocalSettingMutable: (name: string) => {
            if (name !== 'sidebarGroupExpansion') return [{}, vi.fn()];
            const [value, setValue] = ReactModule.useState(mocks.expansion);
            mocks.renderExpansion = setValue;
            return [value, (next: Record<string, boolean>) => {
                mocks.expansion = next;
                mocks.setExpansion(next);
                setValue(next);
            }];
        },
        useLocalSettingUpdater: () => mocks.updateExpansion,
        useSetting: () => ({ lists: [], tags: [], sessions: {} }),
    };
});
vi.mock('@/hooks/useNavigateToSession', () => ({ useNavigateToSession: () => vi.fn() }));
vi.mock('@/hooks/useSessionManagementPreferences', () => ({
    useSessionManagementPreferences: () => ({ preferences: { pinnedOrder: [], focusOrder: [] } }),
}));
vi.mock('@/hooks/useLocalDayRollover', () => ({ useLocalDayRollover: () => 1 }));
vi.mock('@/utils/sessionUtils', () => ({
    formatPathRelativeToHome: (path: string) => path,
    getSessionStateLabel: (state: string) => state,
}));
vi.mock('./SessionRowChrome', () => ({
    SessionRowActions: () => null,
    SessionRowDetails: () => null,
    useSessionRowDisclosure: () => ({
        detailsAnchor: null,
        interactionProps: {},
        titleOverflowing: false,
        visible: false,
        wrapperRef: { current: null },
    }),
    useSessionRowPresentation: () => ({ machine: 'Mac', project: 'repo', status: 'idle' }),
}));
vi.mock('./SessionActionsPopover', () => ({}));
vi.mock('./ProjectSectionHeader', async () => {
    const ReactModule = await import('react');
    return { ProjectSectionHeader: (props: any) => ReactModule.createElement('ProjectSectionHeader', props) };
});
vi.mock('./StatusDot', () => ({ StatusDot: () => null }));
vi.mock('./haptics', () => ({ hapticsLight: vi.fn() }));
vi.mock('@/sync/sync', () => ({ sync: { ensureMessagesLoaded: vi.fn() } }));
vi.mock('@/utils/pendingPermission', () => ({ loadPendingPermissionMessageId: vi.fn() }));

const session = {
    id: 'session-1', name: 'Work', subtitle: '', avatarId: 'a', flavor: 'codex', state: 'idle' as const,
    isConnected: true, hasDraft: false, active: true, archived: false, machineId: 'mac',
    path: '/Users/test/repo', homeDir: '/Users/test', completedTodosCount: 0, totalTodosCount: 0, hasUnread: false,
};

describe('ActiveSessionsGroupCompact project expansion persistence', () => {
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.clearAllMocks();
        mocks.expansion = {};
        mocks.renderExpansion = null;
    });

    it('keeps projects expanded by default and restores a collapsed project after remount', () => {
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<ActiveSessionsGroupCompact sessions={[session]} />); });
        const toggle = renderer.root.findByProps({ testID: 'sidebar-project-toggle-mac--%2FUsers%2Ftest%2Frepo' });
        expect(toggle.props.expanded).toBe(true);

        act(() => toggle.props.onToggle());
        expect(renderer.root.findByProps({ testID: 'sidebar-project-toggle-mac--%2FUsers%2Ftest%2Frepo' }).props.expanded).toBe(false);
        act(() => renderer.unmount());

        expect(mocks.setExpansion).toHaveBeenCalledWith({ 'projects:mac--%2FUsers%2Ftest%2Frepo': false });
        act(() => { renderer = TestRenderer.create(<ActiveSessionsGroupCompact sessions={[session]} />); });
        expect(renderer.root.findByProps({ testID: 'sidebar-project-toggle-mac--%2FUsers%2Ftest%2Frepo' }).props.expanded).toBe(false);
        act(() => renderer.root.findByProps({ testID: 'sidebar-project-toggle-mac--%2FUsers%2Ftest%2Frepo' }).props.onToggle());
        act(() => renderer.unmount());

        expect(mocks.setExpansion).toHaveBeenLastCalledWith({});
    });

    it('allows the selected project to stay collapsed after its automatic reveal', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <ActiveSessionsGroupCompact selectedSessionId="session-1" sessions={[session]} />,
            );
        });

        const testID = 'sidebar-project-toggle-mac--%2FUsers%2Ftest%2Frepo';
        expect(renderer.root.findByProps({ testID }).props.expanded).toBe(true);
        act(() => renderer.root.findByProps({ testID }).props.onToggle());

        expect(renderer.root.findByProps({ testID }).props.expanded).toBe(false);
        expect(mocks.expansion).toEqual({ 'projects:mac--%2FUsers%2Ftest%2Frepo': false });
        act(() => renderer.unmount());
    });
});
