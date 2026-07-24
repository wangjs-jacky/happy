import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AskApiSettingsScreen from '@/app/(app)/settings/ask';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

vi.mock('react-native', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ItemList', () => ({ ItemList: 'ItemList' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/sync/storage', () => ({
    useLocalSettingMutable: () => [{
        apiKey: '',
        baseUrl: '',
        tavilyApiKey: '',
    }, vi.fn()],
}));
vi.mock('@/utils/askApiConfig', () => ({ isAskApiConfigured: () => false }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: (theme: unknown) => object) => factory({}),
        hairlineWidth: 1,
    },
    useUnistyles: () => ({
        theme: {
            colors: {
                divider: '#333333',
                input: { background: '#0a0a0b' },
                text: '#e5e5e7',
                textSecondary: '#6b6b76',
            },
        },
    }),
}));

describe('AskApiSettingsScreen 可访问语义', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('三个输入框都使用对应的可见标题作为名称', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<AskApiSettingsScreen />);
        });

        expect(renderer.root.findAllByType('TextInput').map((node: any) => node.props.accessibilityLabel))
            .toEqual([
                'askApiSettings.apiKey',
                'askApiSettings.baseUrl',
                'askApiSettings.tavilyApiKey',
            ]);

        act(() => renderer.unmount());
    });
});
