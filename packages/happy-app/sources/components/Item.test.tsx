import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Item } from './Item';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Platform: {
        OS: 'web',
        select: (values: Record<string, unknown>) => values.web ?? values.default,
    },
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./haptics', () => ({ hapticsLight: vi.fn() }));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            groupped: { chevron: '#6b6b76' },
            shadow: { color: '#000000', opacity: 0.1 },
            surfacePressedOverlay: '#222222',
            surfaceRipple: '#333333',
            text: '#e5e5e7',
            textDestructive: '#ff4757',
            textSecondary: '#6b6b76',
        },
    };
    return {
        StyleSheet: {
            create: (factory: unknown) => typeof factory === 'function'
                ? (factory as (value: typeof theme, runtime: object) => object)(theme, {})
                : factory,
        },
        useUnistyles: () => ({ theme }),
    };
});

describe('Item 可访问语义', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('交互 Item 默认暴露 button 角色', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<Item title="重试" onPress={() => {}} />);
        });

        expect(renderer.root.findByType('Pressable').props.accessibilityRole).toBe('button');

        act(() => renderer.unmount());
    });

    it('允许调用方覆盖角色和选中状态', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <Item
                    title="机器 A"
                    onPress={() => {}}
                    accessibilityRole="radio"
                    aria-checked
                />,
            );
        });

        const pressable = renderer.root.findByType('Pressable');
        expect(pressable.props.accessibilityRole).toBe('radio');
        expect(pressable.props['aria-checked']).toBe(true);

        act(() => renderer.unmount());
    });

    it('空 subtitle 和 detail 不会作为裸文本节点传给 View', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <Item title="无描述 Skill" subtitle="" detail="" onPress={() => {}} />,
            );
        });

        const hasRawEmptyText = renderer.root.findAllByType('View').some((node: any) => {
            const children = Array.isArray(node.props.children)
                ? node.props.children
                : [node.props.children];
            return children.includes('');
        });
        expect(hasRawEmptyText).toBe(false);

        act(() => renderer.unmount());
    });
});
