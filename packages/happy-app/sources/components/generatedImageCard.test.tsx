import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer 没有随包发布 TypeScript 声明。
// @ts-expect-error 测试只使用 create/unmount 所需的最小接口。
import TestRenderer from 'react-test-renderer';

import { GeneratedImageCard } from './GeneratedImageCard';

vi.mock('react-native', () => ({
    FlatList: 'FlatList',
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
    useWindowDimensions: () => ({ width: 1280, height: 900 }),
}));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: (theme: object) => object) => factory({
            colors: {
                divider: '#333333',
                groupped: { background: '#000000' },
                surface: '#111111',
                surfaceHigh: '#222222',
                text: '#ffffff',
                textSecondary: '#888888',
            },
        }),
    },
    useUnistyles: () => ({
        theme: {
            colors: {
                divider: '#333333',
                groupped: { background: '#000000' },
                surface: '#111111',
                surfaceHigh: '#222222',
                text: '#ffffff',
                textSecondary: '#888888',
            },
        },
    }),
}));
vi.mock('expo-router', () => ({
    useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/hooks/useGeneratedImages', () => ({
    useGeneratedImages: () => [],
}));
vi.mock('@/hooks/useAttachmentImage', () => ({
    useAttachmentImage: () => ({ uri: 'blob:generated-image' }),
}));
vi.mock('@/sync/imageViewer', () => ({
    imageViewer: { open: vi.fn() },
}));
vi.mock('@/text', () => ({
    t: (key: string) => ({
        'generatedImages.openImage': '打开图片',
        'generatedImages.openSession': '打开会话',
    })[key] ?? key,
}));
vi.mock('@/utils/thumbhash', () => ({
    thumbhashToDataUri: () => undefined,
}));

describe('生成图片卡片可访问语义', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('预览和会话入口都暴露具名 button 角色', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <GeneratedImageCard
                    item={{
                        id: 'image-1',
                        sessionId: 'session-1',
                        ref: { type: 'image', id: 'ref-1' },
                        name: 'image.png',
                        createdAt: 1,
                        sessionTitle: 'session',
                        width: 1024,
                        height: 1024,
                    } as any}
                    cardWidth={180}
                    cardHeight={320}
                    isLastColumn={false}
                />,
            );
        });

        const buttons = renderer.root.findAllByType('Pressable');
        expect(buttons.map((button: any) => button.props.accessibilityRole))
            .toEqual(['button', 'button']);
        expect(buttons.map((button: any) => button.props.accessibilityLabel))
            .toEqual(['打开图片', '打开会话']);

        act(() => renderer.unmount());
    });
});
