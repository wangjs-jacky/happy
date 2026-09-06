import * as React from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error narrow renderer harness
import TestRenderer from 'react-test-renderer';
const mocks = vi.hoisted(() => ({ state: {} as any, dispatch: vi.fn(), back: vi.fn() }));
vi.mock('react-native', () => ({ Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', View: 'View' }));
vi.mock('@react-navigation/native', () => ({
    createNavigatorFactory: (component: any) => () => ({ Navigator: component }),
    useNavigationBuilder: () => ({ state: mocks.state, descriptors: Object.fromEntries(mocks.state.routes.map((route: any) => [route.key, { route, render: () => null, options: { headerTitle: route.name, headerRight: () => 'action' } }])), navigation: { dispatch: mocks.dispatch, goBack: mocks.back }, describe: vi.fn(), NavigationContent: React.Fragment }),
}));
vi.mock('@react-navigation/native-stack', () => ({ NativeStackView: 'NativeStackView' }));
vi.mock('expo-router', () => ({ withLayoutContext: (component: any) => component }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/hooks/useDesktopWorkspaceLayout', () => ({ DesktopWorkspaceLayoutIsolation: ({ children }: any) => children }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('react-native-unistyles', () => {
    const theme = { colors: { surface: 'surface', surfacePressed: 'pressed', divider: 'divider', shadow: { color: 'shadow' }, header: { tint: 'tint', background: 'header' } } };
    return { StyleSheet: { create: (f: any) => f(theme), absoluteFill: {}, hairlineWidth: 1 }, useUnistyles: () => ({ theme }) };
});
import { DesktopStackNavigator } from './DesktopAppStack';
import { navigateDesktopModalBack } from '@/navigation/desktopModalNavigation';
let renderer: any;
afterEach(() => act(() => renderer?.unmount()));

describe('desktop app stack presentation', () => {
    it('renders only background outside and only descendants inside, including during close animation', () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        const background = { key: 'background', name: 'session/[id]', params: { id: 'original' } };
        mocks.state = { key: 'app', index: 2, routes: [background, { key: 'inbox', name: 'inbox/index' }, { key: 'friend', name: 'user/[id]' }], preloadedRoutes: [{ key: 'preload', name: 'dev/index' }], desktopModalBaseKey: 'background' };
        act(() => { renderer = TestRenderer.create(<DesktopStackNavigator children={null} />); });
        const stacks = renderer.root.findAllByType('NativeStackView');
        expect(stacks).toHaveLength(2);
        expect(stacks[0].props.state.routes).toEqual([background]);
        expect(stacks[1].props.state.routes.map((r: any) => r.key)).toEqual(['inbox', 'friend']);
        expect(stacks[0].props.state.preloadedRoutes).toEqual([]);
        expect(stacks[1].props.state.preloadedRoutes).toEqual([]);
        expect(renderer.root.findByProps({ testID: 'desktop-modal-back' })).toBeDefined();
        expect(navigateDesktopModalBack(false)).toBe(true);
        expect(mocks.back).toHaveBeenCalled();
        act(() => renderer.root.findByProps({ testID: 'desktop-modal-close' }).props.onPress());
        expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'CLOSE_DESKTOP_MODAL', target: 'app' });
        mocks.state = { ...mocks.state, routes: [background], index: 0, desktopModalBaseKey: undefined };
        act(() => renderer.update(<DesktopStackNavigator children={null} />));
        expect(renderer.root.findAllByType('NativeStackView')).toHaveLength(1);
        expect(navigateDesktopModalBack(false)).toBe(false);
    });
});
