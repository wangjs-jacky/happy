import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

import { FAB } from './FAB';

vi.mock('react-native', () => ({
    Pressable: 'Pressable',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: (theme: object, runtime: object) => object) => factory({
            colors: {
                fab: {
                    background: '#111111',
                    backgroundPressed: '#222222',
                    icon: '#ffffff',
                },
                shadow: { color: '#000000', opacity: 0.2 },
            },
        }, {}),
    },
    useUnistyles: () => ({
        theme: {
            colors: {
                fab: { icon: '#ffffff' },
            },
        },
    }),
}));

describe('FAB 可访问语义', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('使用调用方提供的动作名称暴露 button 角色', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <FAB accessibilityLabel="新建工件" onPress={() => {}} />,
            );
        });

        const button = renderer.root.findByType('Pressable');
        expect(button.props.accessibilityRole).toBe('button');
        expect(button.props.accessibilityLabel).toBe('新建工件');

        act(() => renderer.unmount());
    });
});
