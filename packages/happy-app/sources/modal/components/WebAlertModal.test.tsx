import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebAlertModal } from './WebAlertModal';
import { WebPromptModal } from './WebPromptModal';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: object) => styles },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
}));
vi.mock('./BaseModal', () => ({
    BaseModal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('./modalShadow', () => ({ getModalShadowStyle: () => ({}) }));
vi.mock('@/text', () => ({
    t: (key: string) => ({
        'common.cancel': '取消',
        'common.ok': '确定',
    })[key] ?? key,
}));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({
        theme: {
            colors: {
                divider: '#333333',
                input: {
                    background: '#0a0a0b',
                    placeholder: '#6b6b76',
                },
                shadow: { color: '#000000' },
                surface: '#131316',
                text: '#e5e5e7',
                textDestructive: '#ff4757',
                textLink: '#00d4ff',
            },
        },
    }),
}));

describe('WebAlertModal 可访问语义', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('确认框的取消和确认操作都暴露 button 角色', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <WebAlertModal
                    config={{
                        id: 'confirm-test',
                        type: 'confirm',
                        title: '确认操作',
                        message: '是否继续？',
                        confirmText: '继续',
                    }}
                    onClose={() => {}}
                    onConfirm={() => {}}
                />,
            );
        });

        expect(renderer.root.findAllByType('Pressable').map((node: any) => node.props.accessibilityRole))
            .toEqual(['button', 'button']);

        act(() => renderer.unmount());
    });

    it('输入框弹窗的取消和确认操作都暴露 button 角色', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <WebPromptModal
                    config={{
                        id: 'prompt-test',
                        type: 'prompt',
                        title: '输入内容',
                    }}
                    onClose={() => {}}
                    onConfirm={() => {}}
                />,
            );
        });

        expect(renderer.root.findAllByType('Pressable').map((node: any) => node.props.accessibilityRole))
            .toEqual(['button', 'button']);

        act(() => renderer.unmount());
    });
});
