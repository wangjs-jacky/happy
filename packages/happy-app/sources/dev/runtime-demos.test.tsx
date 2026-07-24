import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

import LogsScreen from '@/app/(app)/dev/logs';
import TestsScreen from '@/app/(app)/dev/tests';
import UnistylesDemo from '@/app/(app)/dev/unistyles-demo';
import { resolveThemeMode } from '@/themePacks';

const {
    runtime,
    setTheme,
    testRunner,
    theme,
} = vi.hoisted(() => ({
    runtime: {
        breakpoint: 'lg',
        colorScheme: 'dark',
        contentSizeCategory: 'medium',
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
        isPortrait: true,
        screen: { width: 800, height: 900 },
        themeName: 'terminalDark',
    },
    setTheme: vi.fn(),
    testRunner: {
        getSuites: vi.fn(() => ['加密套件']),
        runAll: vi.fn(async () => [{
            name: '加密套件',
            tests: [{ name: '示例', passed: true, duration: 1 }],
        }]),
        runSuite: vi.fn(),
    },
    theme: {
        colors: {
            accent: '#00ff88',
            divider: '#303030',
            groupped: {
                background: '#080808',
            },
            surface: '#101010',
            surfaceHigh: '#181818',
            text: '#f5f5f5',
            textSecondary: '#aaaaaa',
        },
    },
}));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Dimensions: {
        get: () => ({ width: 1440, height: 900 }),
    },
    FlatList: 'FlatList',
    Platform: {
        OS: 'web',
        select: (values: Record<string, unknown>) => values.web ?? values.default,
    },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Switch: 'Switch',
    Text: 'Text',
    useWindowDimensions: () => ({ width: 800, height: 900 }),
    View: 'View',
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: unknown) => typeof factory === 'function'
            ? (factory as (value: typeof theme, runtimeValue: typeof runtime) => object)(theme, runtime)
            : factory,
    },
    UnistylesRuntime: {
        setTheme,
    },
    useUnistyles: () => ({ theme, rt: runtime }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('expo-router', () => ({ Stack: { Screen: 'StackScreen' } }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ItemList', () => ({ ItemList: 'ItemList' }));
vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        mono: () => ({}),
    },
}));
vi.mock('@/dev/testRunner', () => ({ testRunner }));
vi.mock('@/encryption/hmac_sha512.appspec', () => ({}));
vi.mock('@/encryption/deriveKey.appspec', () => ({}));
vi.mock('@/sync/encryption/encryptor.appspec', () => ({}));
vi.mock('@/encryption/aes.appspec', () => ({}));
vi.mock('@/encryption/base64.appspec', () => ({}));
vi.mock('@/log', () => ({
    MAX_APP_LOG_ENTRIES: 1000,
    log: {
        clear: vi.fn(),
        getCount: () => 1,
        getLogs: () => [],
        log: vi.fn(),
        onChange: () => () => {},
    },
}));
vi.mock('@/modal', () => ({
    Modal: {
        alert: vi.fn(),
        confirm: vi.fn(async () => false),
    },
}));
vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, unknown>) => {
        if (key === 'devTools.currentBreakpoint') {
            return `当前断点宽度：${String(params?.width)}`;
        }
        if (key === 'devTools.currentTheme') {
            return `当前主题：${String(params?.theme)}`;
        }
        return key;
    },
}));

const flattenStyle = (style: object | object[] | undefined) => Object.assign(
    {},
    ...(Array.isArray(style) ? style : [style]).filter(Boolean),
);

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('日志演示页', () => {
    it('让页面和日志表面跟随主题并稳定命名清空操作', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<LogsScreen />);
        });

        const screen = renderer.root.findByProps({ testID: 'dev-logs-screen' });
        const logSurface = renderer.root.findByProps({ testID: 'dev-logs-surface' });
        const clearItem = renderer.root.findByProps({ testID: 'dev-logs-clear' });

        expect(flattenStyle(screen.props.style).backgroundColor).toBe(theme.colors.groupped.background);
        expect(flattenStyle(logSurface.props.style).backgroundColor).toBe(theme.colors.surface);
        expect(clearItem.props.accessibilityLabel).toBe('devTools.clearAllLogs');

        act(() => renderer.unmount());
    });
});

describe('应用内测试演示页', () => {
    it('运行后让汇总区域跟随当前主题', async () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<TestsScreen />);
        });

        const runAll = renderer.root
            .findAllByType('Item')
            .find((node: any) => node.props.title === 'devTools.runAllTests');
        await act(async () => {
            await runAll.props.onPress();
        });

        const screen = renderer.root.findByProps({ testID: 'dev-tests-screen' });
        const summary = renderer.root.findByProps({ testID: 'dev-tests-summary' });
        const total = renderer.root.findByProps({ testID: 'dev-tests-total' });
        const passed = renderer.root.findByProps({ testID: 'dev-tests-passed' });
        const failed = renderer.root.findByProps({ testID: 'dev-tests-failed' });
        expect(flattenStyle(screen.props.style).backgroundColor).toBe(theme.colors.groupped.background);
        expect(flattenStyle(summary.props.style).backgroundColor).toBe(theme.colors.surface);
        expect(total.props.children).toBe(1);
        expect(passed.props.children).toBe(1);
        expect(failed.props.children).toBe(0);

        act(() => renderer.unmount());
    });
});

describe('主题模式解析', () => {
    it.each([
        ['sakuraLight', true, 'sakuraDark'],
        ['terminalDark', false, 'terminalLight'],
        [undefined, false, 'caramelLight'],
        [null, true, 'caramelDark'],
        ['unknownTheme', true, 'caramelDark'],
    ] as const)('%s 切换为 dark=%s 后解析正确', (current, isDark, expected) => {
        expect(resolveThemeMode(current, isDark)).toBe(expected);
    });
});

describe('Unistyles 演示页', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        setTheme.mockClear();
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('主题选项保留当前主题包并暴露互斥状态', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<UnistylesDemo />);
        });

        const group = renderer.root
            .findAllByType('View')
            .find((node: any) => node.props.accessibilityRole === 'radiogroup');
        const options = renderer.root
            .findAllByType('Pressable')
            .filter((node: any) => node.props.accessibilityRole === 'radio');

        expect(group.props.accessibilityLabel).toBe('devTools.themeSystem');
        expect(options).toHaveLength(2);
        expect(options.map((node: any) => node.props['aria-checked'])).toEqual([false, true]);

        act(() => {
            options[0].props.onPress();
            options[1].props.onPress();
        });
        expect(setTheme).toHaveBeenNthCalledWith(1, 'terminalLight');
        expect(setTheme).toHaveBeenNthCalledWith(2, 'terminalDark');

        act(() => renderer.unmount());
    });

    it('运行时开关具备名称和状态、空操作不进入焦点且宽度使用实时视口', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<UnistylesDemo />);
        });

        const runtimeSwitch = renderer.root.findByType('Switch');
        const colorSchemeButtons = renderer.root
            .findAllByType('Pressable')
            .filter((node: any) => node.props.testID === 'dev-unistyles-color-scheme');
        const texts = renderer.root.findAllByType('Text')
            .flatMap((node: any) => React.Children.toArray(node.props.children));

        expect(runtimeSwitch.props.accessibilityLabel).toBe('devTools.showRuntimeDetails');
        expect(runtimeSwitch.props.accessibilityState).toEqual({ checked: true });
        expect(colorSchemeButtons).toHaveLength(0);
        expect(texts).toContain('当前断点宽度：800');

        act(() => renderer.unmount());
    });

    it('页面、章节标题和说明使用主题文字令牌', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<UnistylesDemo />);
        });

        const screen = renderer.root.findByProps({ testID: 'dev-unistyles-screen' });
        const heading = renderer.root.findByProps({ testID: 'dev-unistyles-theme-heading' });
        const breakpointDescription = renderer.root.findByProps({
            testID: 'dev-unistyles-breakpoint-description',
        });

        expect(flattenStyle(screen.props.style).backgroundColor).toBe(theme.colors.groupped.background);
        expect(flattenStyle(heading.props.style).color).toBe(theme.colors.text);
        expect(flattenStyle(breakpointDescription.props.style).color).toBe(theme.colors.textSecondary);

        act(() => renderer.unmount());
    });

    it('Web 章节只使用 boxShadow 而不下发原生阴影属性', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<UnistylesDemo />);
        });

        const section = renderer.root.findByProps({ testID: 'dev-unistyles-theme-section' });
        const style = flattenStyle(section.props.style);
        expect(style.boxShadow).toBeTypeOf('string');
        expect(style.shadowColor).toBeUndefined();
        expect(style.shadowOffset).toBeUndefined();
        expect(style.shadowOpacity).toBeUndefined();
        expect(style.shadowRadius).toBeUndefined();

        act(() => renderer.unmount());
    });
});
