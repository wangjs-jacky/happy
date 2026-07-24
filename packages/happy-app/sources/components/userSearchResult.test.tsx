import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserSearchResult } from './UserSearchResult';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

const push = vi.fn();

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Pressable: 'Pressable',
    Text: 'Text',
    TouchableOpacity: 'TouchableOpacity',
    View: 'View',
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (styles: object) => styles,
    },
}));
vi.mock('expo-router', () => ({
    useRouter: () => ({ push }),
}));
vi.mock('@/components/Avatar', () => ({
    Avatar: 'Avatar',
}));
vi.mock('@/text', () => ({
    t: (key: string) =>
        ({
            'friends.addFriend': '添加好友',
            'friends.alreadyFriends': '已是好友',
            'friends.requestPending': '请求待处理',
            'friends.requestSent': '请求已发送',
        }[key] ?? key),
}));

const baseUser = {
    id: 'user-test',
    firstName: '测试',
    lastName: '用户',
    username: 'fixture-user',
    avatar: null,
    bio: null,
    status: 'none' as const,
};

describe('UserSearchResult 可访问与点击语义', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        push.mockReset();
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('资料入口和添加操作是同级具名 button，点击添加不会打开资料', () => {
        const onAddFriend = vi.fn();
        let renderer: any;

        act(() => {
            renderer = TestRenderer.create(<UserSearchResult user={baseUser} onAddFriend={onAddFriend} />);
        });

        const row = renderer.root.findByType('Pressable');
        const action = renderer.root.findByType('TouchableOpacity');

        expect(row.props.accessibilityRole).toBe('button');
        expect(row.props.accessibilityLabel).toBe('测试 用户, @fixture-user');
        expect(action.props.accessibilityRole).toBe('button');
        expect(action.props.accessibilityLabel).toBe('添加好友');
        expect(action.props.accessibilityState).toEqual({ disabled: false });
        expect(row.parent).toBe(action.parent);

        act(() => action.props.onPress());

        expect(onAddFriend).toHaveBeenCalledOnce();
        expect(push).not.toHaveBeenCalled();

        act(() => row.props.onPress());

        expect(push).toHaveBeenCalledWith('/user/user-test');

        act(() => renderer.unmount());
    });

    it('已有好友的操作暴露名称和禁用状态', () => {
        let renderer: any;

        act(() => {
            renderer = TestRenderer.create(
                <UserSearchResult user={{ ...baseUser, status: 'friend' }} onAddFriend={() => {}} />,
            );
        });

        const action = renderer.root.findByType('TouchableOpacity');
        expect(action.props.accessibilityLabel).toBe('已是好友');
        expect(action.props.accessibilityState).toEqual({ disabled: true });
        expect(action.props.disabled).toBe(true);

        act(() => renderer.unmount());
    });
});
