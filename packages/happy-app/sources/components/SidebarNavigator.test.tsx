import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarNavigator } from './SidebarNavigator';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    isTablet: true,
    clearSelection: vi.fn(),
    setZenMode: vi.fn(),
}));

vi.mock('@/auth/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true }),
}));
vi.mock('@/utils/responsive', () => ({
    useIsTablet: () => mocks.isTablet,
    useHeaderHeight: () => 48,
}));
vi.mock('./SidebarView', () => ({ SidebarView: 'SidebarView' }));
vi.mock('expo-router/drawer', () => ({ Drawer: 'Drawer' }));
vi.mock('expo-router', () => ({
    useRouter: () => ({
        back: vi.fn(),
        canGoBack: () => false,
    }),
}));
vi.mock('react-native', async () => {
    const React = await import('react');
    return {
        // 只渲染导航器根 View 的第一个子节点 Drawer，隔离与本测试无关的 PersistentHeader。
        View: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement(
            'View',
            props,
            Array.isArray(children) ? children[0] : children,
        ),
        Pressable: 'Pressable',
        Platform: { OS: 'web' },
        BackHandler: { addEventListener: vi.fn() },
        useWindowDimensions: () => ({ width: 1200, height: 800 }),
    };
});
vi.mock('@/sync/storage', () => ({
    useLocalSetting: () => false,
    useLocalSettingMutable: () => [false, mocks.setZenMode],
}));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({
        theme: {
            colors: {
                surface: '#111',
                text: '#fff',
                textSecondary: '#aaa',
            },
        },
    }),
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/isTauri', () => ({ isTauri: () => false }));
vi.mock('@/-session/sessionOverlayNav', () => {
    const useOverlayNav = Object.assign(
        (selector: (state: { canBack: boolean; canForward: boolean }) => unknown) => selector({
            canBack: false,
            canForward: false,
        }),
        {
            getState: () => ({
                back: () => false,
                forward: () => false,
            }),
        },
    );
    return { useOverlayNav };
});
vi.mock('@/hooks/useTauriZoom', () => ({ DEFAULT_APP_ZOOM: 1 }));
vi.mock('@/navigation/browserNavigation', () => ({
    canRouteForward: () => false,
    canUseRouteBack: () => false,
    getNavigatorCanGoBack: () => false,
}));
vi.mock('@/navigation/browserNavigationStore', () => {
    const state = {
        routeHistory: null,
        markRouteBack: vi.fn(),
        markRouteForward: vi.fn(),
    };
    const useBrowserNavigationStore = Object.assign(
        (selector: (value: typeof state) => unknown) => selector(state),
        { getState: () => state },
    );
    return { useBrowserNavigationStore };
});
vi.mock('@/hooks/useSessionSelection', () => ({
    useSessionSelection: (
        selector: (state: { active: boolean; clearSelection: () => void }) => unknown,
    ) => selector({ active: false, clearSelection: mocks.clearSelection }),
}));

describe('SidebarNavigator drawer behavior', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mocks.isTablet = true;
        vi.clearAllMocks();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it.each([
        { isTablet: true, expected: false, layout: 'desktop' },
        { isTablet: false, expected: true, layout: 'phone' },
    ])('sets closeDrawerOnNavigate to $expected for $layout layout', ({ isTablet, expected }) => {
        mocks.isTablet = isTablet;
        let renderer: any;

        act(() => {
            renderer = TestRenderer.create(<SidebarNavigator />);
        });

        const drawer = renderer.root.findByType('Drawer');
        const sidebar = drawer.props.drawerContent();
        expect(sidebar.props.closeDrawerOnNavigate).toBe(expected);
        act(() => renderer.unmount());
    });
});
