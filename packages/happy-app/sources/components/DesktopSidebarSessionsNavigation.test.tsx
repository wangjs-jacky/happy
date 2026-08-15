import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer does not publish declarations.
import TestRenderer from 'react-test-renderer';
import { DesktopSidebarSessionsNavigation } from './DesktopSidebarSessionsNavigation';

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    navigateToSession: vi.fn(),
    updateOrganization: vi.fn(),
    setAgentType: vi.fn(),
    setInput: vi.fn(),
    setMachineId: vi.fn(),
    setPath: vi.fn(),
}));

vi.mock('react-native', () => ({
    Modal: 'Modal', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'TextInput', View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
vi.mock('expo-router', () => ({
    usePathname: () => '/session/session-1',
    useRouter: () => ({ navigate: mocks.navigate }),
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        hairlineWidth: 1,
        create: (factory: any) => factory({
            colors: {
                accent: '#078', button: { primary: { background: '#078', tint: '#fff' } }, divider: '#ddd',
                groupped: { sectionTitle: '#666' }, shadow: { color: '#000', opacity: 0.2 }, surface: '#fff',
                surfaceHigh: '#f5f5f5', surfacePressed: '#eee', surfaceSelected: '#e5e5e5', text: '#111', textSecondary: '#666',
            },
        }),
        absoluteFill: {},
    },
    useUnistyles: () => ({ theme: { colors: {
        accent: '#078', deleteAction: '#c66', particle: { accent: '#86b' }, success: '#498',
        textLink: '#48b', textSecondary: '#666', surfaceHigh: '#eee', button: { primary: { tint: '#fff' } },
    } } }),
}));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/hooks/useNavigateToSession', () => ({ useNavigateToSession: () => mocks.navigateToSession }));
vi.mock('@/hooks/useNewSessionDraft', () => ({ useNewSessionDraft: { getState: () => ({
    setAgentType: mocks.setAgentType,
    setInput: mocks.setInput,
    setMachineId: mocks.setMachineId,
    setPath: mocks.setPath,
}) } }));
vi.mock('@/hooks/useVisibleSessionListViewData', () => ({
    useVisibleSessionListViewData: () => [{ type: 'active-sessions', sessions: [{
        id: 'session-1', name: 'Sidebar work', subtitle: 'Happy', avatarId: 'a', flavor: 'codex', state: 'idle',
        isConnected: true, hasDraft: false, active: true, archived: false, machineId: 'mac', path: '~/happy', homeDir: '~',
        completedTodosCount: 0, totalTodosCount: 0, hasUnread: false,
    }] }],
}));
vi.mock('@/modal', () => ({ Modal: { prompt: vi.fn() } }));
vi.mock('@/sync/storage', async () => {
    const ReactModule = await import('react');
    const organization = {
        lists: [{ id: 'happy', name: 'Happy', kind: 'workspace', color: 'blue', machineId: 'mac', path: '~/happy', defaultAgent: 'codex', createdAt: 1 }],
        tags: [{ id: 'product', name: 'product', color: 'green', createdAt: 1 }],
        sessions: { 'session-1': { listId: 'happy', tagIds: ['product'] } },
    };
    return {
        useAllMachines: () => [],
        useLocalSettingMutable: (name: string) => ReactModule.useState(name === 'desktopSidebarMode' ? 'projects' : organization),
        useLocalSettingUpdater: () => mocks.updateOrganization,
    };
});
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./MainView', () => ({ MainView: 'MainView' }));

describe('DesktopSidebarSessionsNavigation', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps Projects as default and does not navigate for sidebar-only organization actions', () => {
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<DesktopSidebarSessionsNavigation />); });

        expect(renderer.root.findAllByType('MainView')).toHaveLength(1);
        expect(renderer.root.findByProps({ testID: 'desktop-sidebar-tab-projects' }).props.accessibilityState).toEqual({ selected: true });

        act(() => renderer.root.findByProps({ testID: 'desktop-sidebar-tab-lists' }).props.onPress());
        expect(renderer.root.findAllByType('MainView')).toHaveLength(0);

        act(() => renderer.root.findByProps({ testID: 'sidebar-list-happy' }).props.onPress());
        act(() => renderer.root.findByProps({ testID: 'sidebar-tag-product' }).props.onPress());

        expect(mocks.navigate).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('carries the owning List into the explicit new-session route', () => {
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<DesktopSidebarSessionsNavigation />); });
        act(() => renderer.root.findByProps({ testID: 'desktop-sidebar-tab-lists' }).props.onPress());

        const createButton = renderer.root.findAllByType('Pressable').find((node: any) => (
            node.props.accessibilityLabel === 'sidebarLists.newSessionInList'
        ));
        act(() => createButton.props.onPress({ stopPropagation: vi.fn() }));

        expect(mocks.setMachineId).toHaveBeenCalledWith('mac');
        expect(mocks.setPath).toHaveBeenCalledWith('~/happy');
        expect(mocks.setAgentType).toHaveBeenCalledWith('codex');
        expect(mocks.navigate).toHaveBeenCalledWith({
            pathname: '/new',
            params: { sidebarListId: 'happy' },
        });
        act(() => renderer.unmount());
    });
});
