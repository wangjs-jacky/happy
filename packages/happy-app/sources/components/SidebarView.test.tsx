import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer does not publish declarations.
import TestRenderer from 'react-test-renderer';
import { SidebarView } from './SidebarView';

const mocks = vi.hoisted(() => ({
    platform: 'web',
    navigate: vi.fn(),
    dispatch: vi.fn(),
    spaceAgent: null as any,
}));

vi.mock('react-native', () => ({
    Platform: { get OS() { return mocks.platform; } },
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('expo-router', () => ({
    useNavigation: () => ({ dispatch: mocks.dispatch }),
    useRouter: () => ({ navigate: mocks.navigate }),
}));
vi.mock('@react-navigation/native', () => ({
    DrawerActions: { closeDrawer: () => ({ type: 'CLOSE_DRAWER' }) },
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        hairlineWidth: 1,
        create: (factory: any) => typeof factory === 'function' ? factory({
            colors: {
                divider: '#ddd',
                groupped: { background: '#fff' },
                status: { error: '#f00' },
                surface: '#fff',
                surfacePressed: '#eee',
                text: '#111',
                textSecondary: '#666',
            },
        }) : factory,
    },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/sync/storage', () => ({
    useFriendRequests: () => [],
    useLocalSetting: () => [],
    useProfile: () => null,
    useRealtimeStatus: () => 'connected',
}));
vi.mock('@/sync/profile', () => ({ getDisplayName: () => 'jacky' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('./useDrawerHaptics', () => ({ useDrawerHaptics: () => undefined }));
vi.mock('./DesktopSettingsModal', () => ({ useDesktopSettingsModal: () => ({ openSettings: vi.fn() }) }));
vi.mock('./CommandPalette/CommandPaletteProvider', () => ({ useCommandPaletteLauncher: () => null }));
vi.mock('@/hooks/useAgentSpace', () => ({
    useAgentSpace: () => ({ agent: mocks.spaceAgent, exit: vi.fn() }),
}));
vi.mock('./DesktopSidebarView', () => ({ DesktopSidebarView: 'DesktopSidebarView' }));
vi.mock('./MobileSidebarSessionsNavigation', () => ({
    MobileSidebarSessionsNavigation: 'MobileSidebarSessionsNavigation',
}));
vi.mock('./SidebarAccountMenu', () => ({ SidebarAccountMenu: 'SidebarAccountMenu' }));
vi.mock('./SidebarHelpMenu', () => ({ SidebarHelpMenu: 'SidebarHelpMenu' }));
vi.mock('./VoiceAssistantStatusBar', () => ({ VoiceAssistantStatusBar: 'VoiceAssistantStatusBar' }));
vi.mock('./agents/AgentSheet', () => ({ AgentSheet: 'AgentSheet' }));
vi.mock('./agents/AgentSpaceWorkbench', () => ({ AgentSpaceWorkbench: 'AgentSpaceWorkbench' }));
vi.mock('./plugins/PluginLeftSidebarSlot', () => ({ PluginLeftSidebarSlot: 'PluginLeftSidebarSlot' }));
vi.mock('./plugins/PluginMarketplaceModal', () => ({ PluginMarketplaceModal: 'PluginMarketplaceModal' }));

describe('SidebarView platform isolation', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mocks.platform = 'web';
        mocks.spaceAgent = null;
        vi.clearAllMocks();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('uses the isolated three-level sidebar only for desktop Web', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<SidebarView closeDrawerOnNavigate={false} desktopDensity />);
        });

        expect(renderer.root.findAllByType('DesktopSidebarView')).toHaveLength(1);
        expect(renderer.root.findAllByType('MobileSidebarSessionsNavigation')).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it.each(['android', 'ios'])('keeps the established native sidebar on %s even with tablet density', (platform) => {
        mocks.platform = platform;
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<SidebarView closeDrawerOnNavigate={false} desktopDensity />);
        });

        expect(renderer.root.findAllByType('DesktopSidebarView')).toHaveLength(0);
        expect(renderer.root.findAllByType('MobileSidebarSessionsNavigation')).toHaveLength(1);
        expect(renderer.root.findAllByProps({ testID: 'sidebar-primary-navigation' })).toHaveLength(1);
        expect(renderer.root.findAllByProps({ testID: 'sidebar-new-session-button' })).toHaveLength(1);
        expect(renderer.root.findAllByProps({ testID: 'sidebar-inbox-button' })).toHaveLength(1);
        expect(renderer.root.findAllByProps({ testID: 'sidebar-command-palette-button' })).toHaveLength(1);
        expect(renderer.root.findAllByProps({ testID: 'sidebar-plugins-button' })).toHaveLength(1);
        expect(renderer.root.findAllByProps({ testID: 'sidebar-my-agents-button' })).toHaveLength(1);
        expect(renderer.root.findAllByType('SidebarAccountMenu')).toHaveLength(1);
        act(() => renderer.unmount());
    });

    it('keeps phone Web on the established drawer instead of enabling desktop architecture', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<SidebarView closeDrawerOnNavigate desktopDensity={false} />);
        });

        expect(renderer.root.findAllByType('DesktopSidebarView')).toHaveLength(0);
        expect(renderer.root.findAllByType('MobileSidebarSessionsNavigation')).toHaveLength(1);
        act(() => renderer.unmount());
    });
});
