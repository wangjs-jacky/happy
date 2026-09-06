import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer does not publish declarations.
import TestRenderer from 'react-test-renderer';
import { ConversationTranscript } from './ConversationTranscript';
import { ChatList } from './ChatList';
import type { Message } from '@/sync/typesMessage';

const sessionState = vi.hoisted(() => ({
    messages: [] as Message[], isLoaded: true, hasMoreOlder: true, isLoadingOlder: false,
}));
vi.mock('@/sync/storage', () => ({
    useSessionMessages: () => sessionState,
    useSession: () => ({ id: 'session', metadata: null }),
    useSetting: () => true,
}));
vi.mock('@/sync/sync', () => ({ sync: { loadOlderMessages: vi.fn() } }));
vi.mock('@/hooks/useSessionQuickActions', () => ({ useSessionQuickActions: () => ({}) }));
vi.mock('@/utils/responsive', () => ({ useHeaderHeight: () => 0 }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
vi.mock('./ChatFooter', () => ({ ChatFooter: 'ChatFooter' }));

vi.mock('react-native', () => ({
    AppState: { addEventListener: () => ({ remove: vi.fn() }) },
    ActivityIndicator: 'ActivityIndicator',
    FlatList: 'FlatList',
    Platform: { OS: 'web' },
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
    ScrollView: 'ScrollView',
    useWindowDimensions: () => ({ width: 1200, height: 800 }),
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
                fab: { background: '#fff' },
            },
        }),
    },
    useUnistyles: () => ({ theme: { colors: { text: '#fff' } } }),
}));
vi.mock('@/hooks/useGroupedMessages', () => ({
    useGroupedMessages: (messages: Message[]) => messages.map((message) => ({ type: 'message', id: message.id, message })),
    isSessionTurnActive: () => false,
}));
vi.mock('@/utils/messageForkPoint', () => ({ getAgentMessageForkTargets: () => new Map() }));
vi.mock('@/modal/components/BaseModal', () => ({ BaseModal: 'BaseModal' }));
vi.mock('@/text', () => ({ t: (key: string, params?: { count: number }) => params ? `${key}:${params.count}` : key }));
vi.mock('./MessageView', () => ({ MessageView: 'MessageView' }));
vi.mock('./ToolGroupView', () => ({ AgentWorkGroupView: 'AgentWorkGroupView', ToolGroupView: 'ToolGroupView' }));
vi.mock('./AttachmentGalleryView', () => ({ AttachmentGalleryView: 'AttachmentGalleryView' }));
vi.mock('./haptics', () => ({ hapticsLight: vi.fn() }));

const userMessage = (id: string): Message => ({ kind: 'user-text', id, localId: null, createdAt: 1, text: id });
const scroll = (renderer: any) => act(() => renderer.root.findByType('FlatList').props.onScroll({
    nativeEvent: { contentOffset: { y: 400 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 800 } },
}));
const byId = (renderer: any, testID: string) => renderer.root.findByProps({ testID });

describe('ConversationTranscript older history pagination', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

    it('keeps partial counts and an open sheet live until the last history page arrives', async () => {
        const onLoadOlder = vi.fn();
        const messages = ['u5', 'u4', 'u3'].map(userMessage);
        let renderer: any;
        const render = (more: boolean, loading = false, current = messages) => (
            <ConversationTranscript metadata={null} messages={current} hasMoreOlder={more}
                isLoadingOlder={loading} onLoadOlder={onLoadOlder} />
        );
        await act(async () => { renderer = TestRenderer.create(render(true)); });
        // No eager history fetch just to produce a total.
        expect(onLoadOlder).not.toHaveBeenCalled();
        scroll(renderer);
        expect(byId(renderer, 'conversation-anchors-count').props.children).toBe('3+');
        act(() => byId(renderer, 'conversation-anchors-button').props.onPress());
        expect(byId(renderer, 'anchor-list-subtitle').props.children).toBe('session.anchorsLoadedSubtitle:3');
        act(() => byId(renderer, 'anchor-list-load-older').props.onPress());
        expect(onLoadOlder).toHaveBeenCalledTimes(1);
        act(() => renderer.update(render(true, true)));
        expect(byId(renderer, 'anchor-list-load-older').props.disabled).toBe(true);
        expect(renderer.root.findAllByType('Text').some((node: any) => node.props.children === 'common.loading')).toBe(true);

        act(() => renderer.update(render(false, false, [...messages, userMessage('u2'), userMessage('u1')])));
        expect(byId(renderer, 'conversation-anchors-count').props.children).toBe(5);
        expect(byId(renderer, 'anchor-list-subtitle').props.children).toBe('session.anchorsSubtitle:5');
        expect(renderer.root.findByType('BaseModal').props.children.props.anchors.map((anchor: any) => anchor.id))
            .toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
        expect(renderer.root.findAllByProps({ testID: 'anchor-list-load-older' })).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('offers older history even when the latest page has no user anchors', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<ConversationTranscript metadata={null}
                messages={[{ kind: 'agent-text', id: 'a1', localId: null, createdAt: 1, text: 'working' }]}
                hasMoreOlder onLoadOlder={vi.fn()} />);
        });
        scroll(renderer);
        expect(byId(renderer, 'conversation-anchors-count').props.children).toBe('0+');
        act(() => byId(renderer, 'conversation-anchors-button').props.onPress());
        expect(byId(renderer, 'anchor-list-load-older')).toBeDefined();
        expect(renderer.root.findAllByType('Text').some((node: any) => node.props.children === 'session.anchorsEmpty')).toBe(false);
        act(() => renderer.unmount());
    });

    it.each([true, false])('resolves a selected anchor after incoming messages shift its index (inverted=%s)', async (inverted) => {
        let renderer: any;
        const scrollToIndex = vi.fn();
        const render = (messages: Message[]) => <ConversationTranscript metadata={null} messages={messages} inverted={inverted} />;
        await act(async () => {
            renderer = TestRenderer.create(render([userMessage('u2'), userMessage('u1')]), {
                createNodeMock: (element: any) => element.type === 'FlatList' ? { scrollToIndex } : null,
            });
        });
        scroll(renderer);
        act(() => byId(renderer, 'conversation-anchors-button').props.onPress());
        const oldSheet = renderer.root.findByType('BaseModal').props.children.props;
        const selected = oldSheet.anchors.find((anchor: any) => anchor.id === 'u2');
        act(() => renderer.update(render([userMessage('u3'), userMessage('u2'), userMessage('u1'), userMessage('u0')])));
        act(() => oldSheet.onSelect(selected));
        expect(scrollToIndex).toHaveBeenLastCalledWith({ index: inverted ? 1 : 2, animated: true, viewPosition: 0.5 });
        act(() => renderer.unmount());
    });

    it('closes the anchor sheet on session changes', async () => {
        let renderer: any;
        const render = (sessionId: string) => <ConversationTranscript metadata={null} sessionId={sessionId} messages={[userMessage('u1')]} />;
        await act(async () => { renderer = TestRenderer.create(render('one')); });
        scroll(renderer);
        act(() => byId(renderer, 'conversation-anchors-button').props.onPress());
        expect(renderer.root.findAllByType('BaseModal')).toHaveLength(1);
        act(() => renderer.update(render('two')));
        expect(renderer.root.findAllByType('BaseModal')).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('passes restored-cache and pagination completeness from ChatList to the live anchors', async () => {
        Object.assign(sessionState, {
            messages: [userMessage('u1')], isLoaded: false, hasMoreOlder: false, isLoadingOlder: false,
        });
        let renderer: any;
        const render = () => <ChatList session={{ id: 'session', metadata: null } as any} />;
        await act(async () => { renderer = TestRenderer.create(render()); });
        scroll(renderer);
        expect(byId(renderer, 'conversation-anchors-count').props.children).toBe('1+');
        act(() => byId(renderer, 'conversation-anchors-button').props.onPress());
        expect(byId(renderer, 'anchor-list-load-older').props.disabled).toBe(true);
        Object.assign(sessionState, { isLoaded: true, hasMoreOlder: true });
        act(() => renderer.update(render()));
        expect(byId(renderer, 'anchor-list-load-older').props.disabled).toBe(false);
        expect(byId(renderer, 'conversation-anchors-count').props.children).toBe('1+');
        Object.assign(sessionState, { hasMoreOlder: false });
        act(() => renderer.update(render()));
        expect(byId(renderer, 'conversation-anchors-count').props.children).toBe(1);
        expect(byId(renderer, 'anchor-list-subtitle').props.children).toBe('session.anchorsSubtitle:1');
        act(() => renderer.unmount());
    });
});
