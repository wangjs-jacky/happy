import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer does not publish declarations used by this narrow test.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    status: { installed: false as const } as
        | { installed: false }
        | { installed: true; baseUrl: string; model: string; keyHint: string },
    refresh: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    replace: vi.fn(),
}));

vi.mock('react-native', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { hairlineWidth: 1, create: (factory: any) => factory({ colors: {
        accent: '#00f', divider: '#ddd', input: { background: '#fff' },
        text: '#111', textSecondary: '#666', surface: '#fff', surfacePressed: '#eee',
    } }) },
    useUnistyles: () => ({ theme: { colors: {
        accent: '#00f', divider: '#ddd', input: { background: '#fff' }, text: '#111', textSecondary: '#666',
    } } }),
}));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ItemList', () => ({ ItemList: 'ItemList' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({
    t: (key: string, args?: { hint?: string }) => args?.hint ? `${key}:${args.hint}` : key,
}));
vi.mock('@/hooks/useRelationshipAdvisorPlugin', () => ({
    useRelationshipAdvisorPlugin: () => ({ loading: false, status: mocks.status, refresh: mocks.refresh }),
}));
vi.mock('@/hooks/useHappyAction', () => ({
    useHappyAction: (action: (...args: any[]) => Promise<void>) => [false, action],
}));
vi.mock('@/sync/relationshipAdvisorPlugin', () => ({
    installRelationshipAdvisorPlugin: mocks.install,
    uninstallRelationshipAdvisorPlugin: mocks.uninstall,
}));

import RelationshipAdvisorPluginSettingsScreen from './relationship-advisor';

function textValue(node: { props: { children?: unknown } }): string {
    const children = node.props.children;
    return Array.isArray(children) ? children.join('') : String(children ?? '');
}

describe('RelationshipAdvisorPluginSettingsScreen', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.status = { installed: false };
        mocks.refresh.mockResolvedValue({ installed: true });
        mocks.install.mockResolvedValue({ installed: true });
        mocks.uninstall.mockResolvedValue({ installed: false });
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('installs the plugin with server-owned provider credentials before opening it', async () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<RelationshipAdvisorPluginSettingsScreen />);
        });
        const fields = renderer.root.findAllByType('TextInput');
        act(() => {
            fields[0].props.onChangeText('sk-secret-1234');
            fields[1].props.onChangeText('https://api.example.com/v1');
            fields[2].props.onChangeText('example-chat');
        });
        const installButton = renderer.root.findAllByType('Item').find((node: any) => (
            textValue({ props: { children: node.props.title } }) === 'relationshipAdvisorPlugin.install'
        ));

        await act(async () => installButton.props.onPress());

        expect(mocks.install).toHaveBeenCalledWith({
            apiKey: 'sk-secret-1234',
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
        });
        expect(mocks.refresh).toHaveBeenCalledTimes(1);
        expect(mocks.replace).toHaveBeenCalledWith('/relationship-advisor');
        act(() => renderer.unmount());
    });

    it('shows only the key hint for an installed plugin', () => {
        mocks.status = {
            installed: true,
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
            keyHint: '1234',
        };
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<RelationshipAdvisorPluginSettingsScreen />);
        });

        const apiKeyField = renderer.root.findAllByType('TextInput')[0];
        expect(apiKeyField.props.value).toBe('');
        expect(apiKeyField.props.placeholder).toContain('1234');
        act(() => renderer.unmount());
    });
});
