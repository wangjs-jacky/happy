import React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer 没有发布 TypeScript 类型；测试只使用 create/unmount。
// @ts-expect-error 测试只依赖这里使用的最小 API。
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    modalShow: vi.fn(),
    logout: vi.fn(),
    navigateToSession: vi.fn(),
    router: {
        navigate: vi.fn(),
        push: vi.fn(),
    },
    keyboardHandler: (() => {}) as () => void,
    state: {
        sessions: {
            abc123456: {
                id: 'abc123456',
                updatedAt: 2,
                metadata: {},
            },
        },
        localSettings: {
            commandPaletteEnabled: true,
        },
    },
}));

vi.stubGlobal('__DEV__', false);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
}));

vi.mock('expo-router', () => ({
    useRouter: () => mocks.router,
}));

vi.mock('@/modal', () => ({
    Modal: { show: mocks.modalShow },
}));

vi.mock('@/auth/AuthContext', () => ({
    useAuth: () => ({ logout: mocks.logout }),
}));

vi.mock('@/sync/storage', () => ({
    storage: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('zustand/react/shallow', () => ({
    useShallow: <T,>(selector: T) => selector,
}));

vi.mock('@/hooks/useNavigateToSession', () => ({
    useNavigateToSession: () => mocks.navigateToSession,
}));

vi.mock('@/hooks/useGlobalKeyboard', () => ({
    useGlobalKeyboard: (handler: () => void) => {
        mocks.keyboardHandler = handler;
    },
}));

vi.mock('@/text', () => ({
    t: (key: string) => {
        const translations: Record<string, string> = {
            'newSession.title': '新会话',
            'sessionHistory.title': '会话',
            'sessionHistory.viewAll': '全部会话',
            'settings.title': '设置',
            'settings.account': '账户',
            'settings.developerTools': '开发者工具',
            'settings.developer': '开发',
            'settingsAccount.linkNewDevice': '连接新设备',
            'settingsAccount.logout': '退出登录',
            'machine.untitledSession': '无标题会话',
            'commandPalette.navigation': '导航',
            'commandPalette.recentSessions': '最近会话',
            'commandPalette.system': '系统',
        };
        return translations[key] ?? `译文：${key}`;
    },
}));

vi.mock('./CommandPalette', () => ({
    CommandPalette: () => null,
}));

import { CommandPaletteProvider } from './CommandPaletteProvider';
import type { Command } from './types';

describe('CommandPaletteProvider', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let renderer: any;

    beforeEach(() => {
        mocks.modalShow.mockReset();
        mocks.logout.mockReset();
        mocks.navigateToSession.mockReset();
        mocks.router.navigate.mockReset();
        mocks.router.push.mockReset();
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    it('静态命令和无标题会话均通过翻译函数生成', () => {
        act(() => {
            renderer = TestRenderer.create(
                <CommandPaletteProvider>
                    <></>
                </CommandPaletteProvider>,
            );
        });

        act(() => {
            mocks.keyboardHandler();
        });

        expect(mocks.modalShow).toHaveBeenCalledOnce();
        const commands = mocks.modalShow.mock.calls[0][0].props.commands as Command[];
        const byId = new Map(commands.map((command) => [command.id, command]));

        expect(byId.get('new-session')).toMatchObject({
            title: '新会话',
            category: '会话',
            subtitle: '译文：commandPalette.newSessionSubtitle',
        });
        expect(byId.get('settings')).toMatchObject({
            title: '设置',
            category: '导航',
            subtitle: '译文：commandPalette.settingsSubtitle',
        });
        expect(byId.get('session-abc123456')).toMatchObject({
            title: '无标题会话 abc123',
            category: '最近会话',
            subtitle: '译文：commandPalette.switchToSession',
        });
    });

    afterEach(() => {
        if (renderer) {
            act(() => renderer.unmount());
        }
        renderer = undefined;
        consoleErrorSpy.mockRestore();
    });
});
