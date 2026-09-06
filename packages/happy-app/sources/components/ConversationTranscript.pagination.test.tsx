import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer does not publish declarations.
import TestRenderer from 'react-test-renderer';
import { ConversationTranscript } from './ConversationTranscript';

vi.mock('react-native', () => ({
    AppState: { addEventListener: () => ({ remove: vi.fn() }) },
    FlatList: 'FlatList',
    Platform: { OS: 'web' },
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Octicons: 'Octicons' }));
vi.mock('react-native-reanimated', () => ({
    default: { View: 'AnimatedView' },
    FadeIn: { duration: () => undefined },
    FadeOut: { duration: () => undefined },
}));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        create: (factory: (theme: Record<string, unknown>) => object) => factory({
            colors: {
                divider: '#444',
                shadow: { color: '#000', opacity: 0.2 },
                surface: '#111',
                text: '#fff',
                textSecondary: '#aaa',
            },
        }),
    },
    useUnistyles: () => ({ theme: { colors: { text: '#fff' } } }),
}));
vi.mock('@/hooks/useGroupedMessages', () => ({ useGroupedMessages: () => [] }));
vi.mock('@/hooks/useUserMessageAnchors', () => ({ useUserMessageAnchors: () => [] }));
vi.mock('@/utils/messageForkPoint', () => ({ getAgentMessageForkTargets: () => new Map() }));
vi.mock('@/modal', () => ({ Modal: { show: vi.fn() } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./MessageView', () => ({ MessageView: 'MessageView' }));
vi.mock('./ToolGroupView', () => ({ AgentWorkGroupView: 'AgentWorkGroupView', ToolGroupView: 'ToolGroupView' }));
vi.mock('./AttachmentGalleryView', () => ({ AttachmentGalleryView: 'AttachmentGalleryView' }));
vi.mock('./AnchorListSheet', () => ({ AnchorListSheet: 'AnchorListSheet' }));

describe('ConversationTranscript older history pagination', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        const originalConsoleError = console.error;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    });

    it('prefetches the next older page two viewports before the visual top', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const onLoadOlder = vi.fn();
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <ConversationTranscript metadata={null} messages={[]} onLoadOlder={onLoadOlder} />,
            );
        });

        const list = renderer.root.findByType('FlatList');
        expect(list.props.onEndReachedThreshold).toBe(2);
        act(() => list.props.onEndReached());
        expect(onLoadOlder).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });
});
