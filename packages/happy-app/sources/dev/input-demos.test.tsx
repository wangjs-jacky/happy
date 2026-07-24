import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

import InputStylesDemo from '@/app/(app)/dev/input-styles';
import InvertedListTest from '@/app/(app)/dev/inverted-list';
import MultiTextInputDemo from '@/app/(app)/dev/multi-text-input';

const { theme } = vi.hoisted(() => ({
    theme: {
        colors: {
            accent: '#00ff88',
            divider: '#303030',
            groupped: {
                background: '#080808',
                sectionTitle: '#909090',
            },
            input: {
                background: '#202020',
                placeholder: '#777777',
                text: '#f5f5f5',
            },
            surface: '#101010',
            surfaceHigh: '#181818',
            text: '#f5f5f5',
            textSecondary: '#aaaaaa',
        },
    },
}));

vi.mock('react-native', () => ({
    Animated: { View: 'AnimatedView' },
    FlatList: 'FlatList',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Platform: {
        OS: 'web',
        select: (values: Record<string, unknown>) => values.web ?? values.default,
    },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: {
        create: (styles: object) => styles,
    },
    Text: 'Text',
    TextInput: 'TextInput',
    TouchableOpacity: 'TouchableOpacity',
    View: 'View',
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: unknown) => typeof factory === 'function'
            ? (factory as (value: typeof theme) => object)(theme)
            : factory,
    },
    useUnistyles: () => ({ theme }),
}));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));
vi.mock('react-native-keyboard-controller', () => ({
    useKeyboardHandler: () => {},
    useKeyboardState: () => ({}),
    useReanimatedKeyboardAnimation: () => ({ height: 0, progress: 0 }),
}));
vi.mock('react-native-reanimated', () => ({
    default: { View: 'AnimatedView' },
    runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
    useSharedValue: (value: unknown) => ({ value }),
}));
vi.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }));
vi.mock('@legendapp/list', () => ({ LegendList: 'LegendList' }));
vi.mock('expo-router', () => ({ Stack: { Screen: 'StackScreen' } }));
vi.mock('@expo/vector-icons', () => ({
    Feather: 'Feather',
    FontAwesome5: 'FontAwesome5',
    Ionicons: 'Ionicons',
    MaterialIcons: 'MaterialIcons',
}));
vi.mock('@/components/MultiTextInput', () => ({
    MultiTextInput: 'MultiTextInput',
}));
vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        mono: () => ({}),
    },
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));

const flattenStyle = (style: object | object[] | undefined) => Object.assign(
    {},
    ...(Array.isArray(style) ? style : [style]).filter(Boolean),
);

describe('倒序列表演示页', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('在 Web 禁用不稳定的 LegendList 并提供两组单选语义', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<InvertedListTest />);
        });

        const groups = renderer.root
            .findAllByType('View')
            .filter((node: any) => node.props.accessibilityRole === 'radiogroup');
        expect(groups).toHaveLength(2);

        const options = renderer.root.findAllByType('TouchableOpacity').slice(0, 6);
        expect(options).toHaveLength(6);
        for (const option of options) {
            expect(option.props.accessibilityRole).toBe('radio');
            expect(option.props['aria-checked']).toBeTypeOf('boolean');
        }

        const legendOption = options[2];
        expect(legendOption.props.disabled).toBe(true);
        expect(legendOption.props.accessibilityState).toMatchObject({ disabled: true });

        act(() => renderer.unmount());
    });

    it('让页面、输入和发送状态跟随主题与真实行为', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<InvertedListTest />);
        });

        const screen = renderer.root.findByProps({ testID: 'dev-inverted-list-screen' });
        const input = renderer.root.findByType('TextInput');
        const send = renderer.root.findAllByType('TouchableOpacity').at(-1);

        expect(flattenStyle(screen.props.style).backgroundColor).toBe(theme.colors.groupped.background);
        expect(input.props.accessibilityLabel).toBe('devTools.typeMessage');
        expect(send.props.accessibilityRole).toBe('button');
        expect(send.props.disabled).toBe(true);

        act(() => renderer.unmount());
    });
});

describe('多段文本输入演示页', () => {
    it('为五个输入提供持久名称并让页面跟随主题', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<MultiTextInputDemo />);
        });

        const screen = renderer.root.findByProps({ testID: 'dev-multi-text-input-screen' });
        const inputs = renderer.root.findAllByType('MultiTextInput');
        const labels = inputs.map((node: any) => node.props.accessibilityLabel);

        expect(flattenStyle(screen.props.style).backgroundColor).toBe(theme.colors.groupped.background);
        expect(inputs).toHaveLength(5);
        expect(labels.every(Boolean)).toBe(true);
        expect(new Set(labels).size).toBe(5);

        act(() => renderer.unmount());
    });
});

describe('输入风格演示页', () => {
    it('只让二十二张外层选择卡进入焦点顺序并暴露单选状态', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<InputStylesDemo />);
        });

        const group = renderer.root
            .findAllByType('View')
            .find((node: any) => node.props.accessibilityRole === 'radiogroup');
        const cards = renderer.root.findAllByType('Pressable');
        const previewInputs = renderer.root.findAllByType('TextInput');

        expect(group.props.accessibilityLabel).toBe('devTools.inputStyleVariantsTitle');
        expect(cards).toHaveLength(22);
        for (const card of cards) {
            expect(card.props.accessibilityRole).toBe('radio');
            expect(card.props['aria-checked']).toBeTypeOf('boolean');
        }
        expect(previewInputs.length).toBeGreaterThan(0);
        for (const input of previewInputs) {
            expect(input.props.focusable).toBe(false);
            expect(input.props.tabIndex).toBe(-1);
        }

        act(() => renderer.unmount());
    });

    it('让页面外壳跟随主题而不改写预览内部配色', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<InputStylesDemo />);
        });

        const screen = renderer.root.findByProps({ testID: 'dev-input-styles-screen' });
        const heading = renderer.root.findByProps({ testID: 'dev-input-styles-heading' });
        const description = renderer.root.findByProps({ testID: 'dev-input-styles-description' });

        expect(flattenStyle(screen.props.style).backgroundColor).toBe(theme.colors.groupped.background);
        expect(flattenStyle(heading.props.style).color).toBe(theme.colors.text);
        expect(flattenStyle(description.props.style).color).toBe(theme.colors.textSecondary);

        act(() => renderer.unmount());
    });
});
