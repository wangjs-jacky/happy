import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    hideSplash: vi.fn().mockResolvedValue(undefined),
    loadFonts: vi.fn(() => new Promise<void>(() => undefined)),
}));

vi.mock('react-native-quick-base64', () => ({}));
vi.mock('expo-splash-screen', () => ({
    setOptions: vi.fn(),
    preventAutoHideAsync: vi.fn().mockResolvedValue(undefined),
    hideAsync: mocks.hideSplash,
}));
vi.mock('expo-router', () => ({
    Slot: 'Slot',
    usePathname: () => '/share/public-id',
}));
vi.mock('@react-navigation/native', () => ({
    DarkTheme: { colors: {} },
    DefaultTheme: { colors: {} },
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('react-native-safe-area-context', () => ({
    initialWindowMetrics: null,
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('react-native-gesture-handler', () => ({
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({ theme: { dark: false, colors: { groupped: { background: '#fff' } } } }),
}));
vi.mock('@/components/ThemeTransition', () => ({
    ThemeCaptureRoot: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/StatusBarProvider', () => ({ StatusBarProvider: () => null }));
vi.mock('@/components/ImageViewerHost', () => ({ ImageViewerHost: 'ImageViewerHost' }));
vi.mock('@/utils/publicSessionShareRouting', () => ({ isPublicSessionSharePath: () => true }));
vi.mock('@/components/appRoot/appRootFonts', () => ({ loadAppRootFonts: mocks.loadFonts }));

import RootLayout from './_layout';

describe('public share root layout', () => {
    let renderer: any;

    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(() => {
        if (renderer) act(() => renderer.unmount());
        renderer = undefined;
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    });

    it('renders a public share immediately while fonts continue loading', async () => {
        // Catches a stalled or failed font request blanking the public page.
        await act(async () => {
            renderer = TestRenderer.create(<RootLayout />);
        });

        expect(mocks.loadFonts).toHaveBeenCalledOnce();
        expect(renderer.root.findByType('Slot')).toBeTruthy();
        expect(renderer.root.findByType('ImageViewerHost')).toBeTruthy();
        expect(mocks.hideSplash).toHaveBeenCalledOnce();
    });
});
