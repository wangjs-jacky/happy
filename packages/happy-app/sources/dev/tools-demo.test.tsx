import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

import Tools2Screen from '@/app/(app)/dev/tools2';

const { theme } = vi.hoisted(() => ({
    theme: {
        colors: {
            groupped: {
                background: '#080808',
            },
            surface: '#101010',
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
}));
vi.mock('expo-router', () => ({ Stack: { Screen: 'StackScreen' } }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/tools/ToolView', () => ({ ToolView: 'ToolView' }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

const flattenStyle = (style: object | object[] | undefined) => Object.assign(
    {},
    ...(Array.isArray(style) ? style : [style]).filter(Boolean),
);

describe('工具视图演示页', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ['devTools.allExamples', ['read', 'readError', 'edit', 'bash', 'bashRunning', 'bashError', 'bashLongCommand', 'bashMultiline', 'bashLargeOutput', 'bashNoOutput', 'bashWithWarnings', 'search', 'write', 'toolPending', 'toolApproved', 'toolDenied', 'toolCanceled']],
        ['devTools.readTool', ['read', 'readError']],
        ['devTools.editTool', ['edit']],
        ['devTools.bashTool', ['bash', 'bashRunning', 'bashError', 'bashLongCommand', 'bashMultiline', 'bashLargeOutput', 'bashNoOutput', 'bashWithWarnings']],
        ['devTools.otherTools', ['search', 'write']],
        ['devTools.permissionStates', ['toolPending', 'toolApproved', 'toolDenied', 'toolCanceled']],
        ['devTools.statusIcons', ['bashRunning', 'bash', 'bashError', 'toolDenied', 'toolCanceled']],
    ])('让%s筛选展示该分类的全部示例', (filterTitle, expectedKeys) => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<Tools2Screen />);
        });

        const filterItem = renderer.root
            .findAllByType('Item')
            .find((node: any) => node.props.title === filterTitle);
        act(() => filterItem.props.onPress());

        expect(filterItem.props.selected).toBe(true);
        expect(filterItem.props.accessibilityRole).toBe('radio');
        expect(filterItem.props.accessibilityState).toEqual({ checked: true });
        expect(filterItem.props['aria-checked']).toBe(true);
        expect(filterItem.props.showChevron).toBe(false);
        const renderedKeys = renderer.root
            .findAllByType('View')
            .map((node: any) => node.props.testID)
            .filter((testID: unknown) => typeof testID === 'string' && testID.startsWith('dev-tool-example-'))
            .map((testID: string) => testID.replace('dev-tool-example-', ''));
        expect(renderedKeys).toEqual(expectedKeys);
        expect(new Set(renderedKeys).size).toBe(renderedKeys.length);

        act(() => renderer.unmount());
    });

    it('把互斥筛选组织成带名称的单选组', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<Tools2Screen />);
        });

        const filterGroup = renderer.root
            .findAllByType('View')
            .find((node: any) => node.props.accessibilityRole === 'radiogroup');
        expect(filterGroup.props.accessibilityLabel).toBe('devTools.filterExamples');

        act(() => renderer.unmount());
    });

    it('让演示卡片保持只读而不是打印无意义点击日志', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<Tools2Screen />);
        });

        for (const toolView of renderer.root.findAllByType('ToolView')) {
            expect(toolView.props.onPress).toBeUndefined();
        }

        act(() => renderer.unmount());
    });

    it('让页面和文字层级跟随当前主题', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<Tools2Screen />);
        });

        const screen = renderer.root.findByType('ScrollView');
        const title = renderer.root
            .findAllByType('Text')
            .find((node: any) => node.props.children === 'devTools.toolViewComponents');
        const description = renderer.root
            .findAllByType('Text')
            .find((node: any) => node.props.children === 'devTools.toolViewComponentsDescription');

        expect(flattenStyle(screen.props.style).backgroundColor).toBe(theme.colors.groupped.background);
        expect(flattenStyle(title?.props.style).color).toBe(theme.colors.text);
        expect(flattenStyle(description?.props.style).color).toBe(theme.colors.textSecondary);

        act(() => renderer.unmount());
    });
});
