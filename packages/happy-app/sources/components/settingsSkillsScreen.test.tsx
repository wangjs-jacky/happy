import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkillsScreen from '@/app/(app)/settings/skills';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    scanSkills: vi.fn(),
}));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'web' },
    TextInput: 'TextInput',
    View: 'View',
}));
vi.mock('expo-router', () => ({
    useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ItemList', () => ({ ItemList: 'ItemList' }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => [
        { id: 'machine-a', metadata: { displayName: '机器 A' } },
        { id: 'machine-b', metadata: { displayName: '机器 B' } },
    ],
}));
vi.mock('@/sync/skills', () => ({
    scanSkills: mocks.scanSkills,
}));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            button: { primary: { background: '#00ff88' } },
            divider: '#333333',
            input: { background: '#131316', placeholder: '#6b6b76' },
            surface: '#131316',
            textSecondary: '#6b6b76',
        },
    };
    return {
        StyleSheet: {
            create: (factory: unknown) => typeof factory === 'function'
                ? (factory as (value: typeof theme) => object)(theme)
                : factory,
        },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/text', () => ({
    t: (key: string) => ({
        'settingsSkills.machine': '机器',
        'settingsSkills.searchPlaceholder': '搜索名称或触发词…',
    })[key] ?? key,
}));

describe('SkillsScreen 可访问语义', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mocks.scanSkills.mockReset();
        mocks.scanSkills.mockResolvedValue([]);
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('为机器选择器和搜索框提供稳定语义', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<SkillsScreen />);
        });
        await act(async () => {
            await Promise.resolve();
        });

        const radioGroup = renderer.root.findAllByType('View')
            .find((node: any) => node.props.accessibilityRole === 'radiogroup');
        const machineItems = renderer.root.findAllByType('Item')
            .filter((node: any) => node.props.title === '机器 A' || node.props.title === '机器 B');
        const searchInput = renderer.root.findByType('TextInput');

        expect(radioGroup?.props.accessibilityLabel).toBe('机器');
        expect(machineItems.map((node: any) => node.props.accessibilityRole)).toEqual(['radio', 'radio']);
        expect(machineItems.map((node: any) => node.props['aria-checked'])).toEqual([true, false]);
        expect(searchInput.props.accessibilityLabel).toBe('搜索名称或触发词…');

        act(() => renderer.unmount());
    });
});
