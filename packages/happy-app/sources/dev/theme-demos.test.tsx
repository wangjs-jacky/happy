import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

import ColorsScreen from '@/app/(app)/dev/colors';
import ListDemoScreen from '@/app/(app)/dev/list-demo';
import ShimmerDemoScreen from '@/app/(app)/dev/shimmer-demo';
import TypographyScreen from '@/app/(app)/dev/typography';

const { theme } = vi.hoisted(() => ({
    theme: {
        colors: {
            groupped: {
                background: '#080808',
                sectionTitle: '#777777',
            },
            surface: '#101010',
            surfaceHigh: '#181818',
            surfaceHighest: '#202020',
            text: '#f5f5f5',
            textSecondary: '#aaaaaa',
        },
    },
}));

vi.mock('react-native', () => ({
    ScrollView: 'ScrollView',
    StyleSheet: {
        create: (styles: object) => styles,
    },
    Text: 'Text',
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
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('expo-router', () => ({ Stack: { Screen: 'StackScreen' } }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ItemList', () => ({ ItemList: 'ItemList' }));
vi.mock('@/components/ShimmerView', () => ({ ShimmerView: 'ShimmerView' }));
vi.mock('@/components/Switch', () => ({ Switch: 'Switch' }));
vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        logo: () => ({}),
        mono: () => ({}),
    },
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));

const flattenStyle = (style: object | object[] | undefined) => Object.assign(
    {},
    ...(Array.isArray(style) ? style : [style]).filter(Boolean),
);

describe('开发者主题演示页', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ['排版', TypographyScreen, 'devTools.ibmPlexSansDefault', theme.colors.surface],
        ['颜色', ColorsScreen, 'devTools.iosSystemColors', theme.colors.surface],
        ['闪烁', ShimmerDemoScreen, 'devTools.shimmerViewExamples', theme.colors.groupped.background],
    ])('让%s演示页跟随当前主题', (_name, Screen, heading, expectedBackground) => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<Screen />);
        });

        const scrollView = renderer.root.findByType('ScrollView');
        const headingText = renderer.root
            .findAllByType('Text')
            .find((node: any) => node.props.children === heading);

        expect(flattenStyle(scrollView.props.style).backgroundColor).toBe(expectedBackground);
        expect(flattenStyle(headingText?.props.style).color).toBe(theme.colors.text);

        act(() => renderer.unmount());
    });

    it('让次级文字和抬升表面使用主题令牌', () => {
        let typographyRenderer: any;
        let colorsRenderer: any;
        let shimmerRenderer: any;
        act(() => {
            typographyRenderer = TestRenderer.create(<TypographyScreen />);
            colorsRenderer = TestRenderer.create(<ColorsScreen />);
            shimmerRenderer = TestRenderer.create(<ShimmerDemoScreen />);
        });

        expect(flattenStyle(
            typographyRenderer.root.findByProps({ testID: 'dev-typography-secondary' }).props.style,
        ).color).toBe(theme.colors.textSecondary);
        expect(flattenStyle(
            typographyRenderer.root.findByProps({ testID: 'dev-typography-elevated' }).props.style,
        ).backgroundColor).toBe(theme.colors.surfaceHigh);
        expect(flattenStyle(
            colorsRenderer.root.findByProps({ testID: 'dev-colors-elevated' }).props.style,
        ).backgroundColor).toBe(theme.colors.surfaceHigh);
        expect(flattenStyle(
            shimmerRenderer.root.findByProps({ testID: 'dev-shimmer-secondary' }).props.style,
        ).color).toBe(theme.colors.textSecondary);
        expect(flattenStyle(
            shimmerRenderer.root.findByProps({ testID: 'dev-shimmer-elevated' }).props.style,
        ).backgroundColor).toBe(theme.colors.surface);

        act(() => {
            typographyRenderer.unmount();
            colorsRenderer.unmount();
            shimmerRenderer.unmount();
        });
    });

    it('为列表演示开关提供业务名称', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<ListDemoScreen />);
        });

        const toggleItem = renderer.root
            .findAllByType('Item')
            .find((node: any) => node.props.title === 'devTools.toggleSwitch');

        expect(toggleItem?.props.rightElement.props.accessibilityLabel).toBe('devTools.toggleSwitch');

        act(() => renderer.unmount());
    });
});
