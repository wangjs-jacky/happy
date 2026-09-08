import * as React from 'react';
import { act } from 'react';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer does not publish declarations.
import TestRenderer from 'react-test-renderer';
import { ConversationTranscript } from './ConversationTranscript';
import { ChatList } from './ChatList';
import type { ReadingState } from '@/sync/localHistoryStore';
import type { Message } from '@/sync/typesMessage';

const sessionState = vi.hoisted(() => ({
    messages: [] as Message[], isLoaded: true, hasMoreOlder: true, isLoadingOlder: false,
    hasMoreNewer: false, isLoadingNewer: false, isAtLatest: true,
}));
const grouped = vi.hoisted(() => ({ items: null as any[] | null }));
vi.mock('@/sync/storage', () => ({
    useSessionMessages: () => sessionState,
    useSession: () => ({ id: 'session', metadata: null }),
    useSetting: () => true,
}));
vi.mock('@/sync/sync', () => ({ sync: { loadOlderMessages: vi.fn(), getLocalHistoryScope: () => null } }));
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
    useGroupedMessages: (messages: Message[]) => grouped.items ?? messages.map((message) => ({ type: 'message', id: message.id, message })),
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
    nativeEvent: { contentOffset: { y: 2000 }, contentSize: { height: 5000 }, layoutMeasurement: { height: 800 } },
}));
const byId = (renderer: any, testID: string) => renderer.root.findByProps({ testID });
const reachOlder = (list: any) => { list.props.onScrollBeginDrag(); list.props.onStartReached(); };
const installFrameQueue = () => {
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => { frames.delete(frame); });
    return async () => {
        const pending = [...frames.values()];
        frames.clear();
        await act(async () => { pending.forEach(callback => callback(0)); });
    };
};

describe('ConversationTranscript older history pagination', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let flushFrame: ReturnType<typeof installFrameQueue>;

    beforeEach(() => {
        flushFrame = installFrameQueue();
        grouped.items = null;
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const originalConsoleError = console.error;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        (Platform as any).OS = 'web';
        delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    });

    it('wires Web wheel ownership to the native scroll node and removes the listener on cleanup', async () => {
        const saved: ReadingState = { version: 1, anchorId: 'wire2', anchorSeq: 2, offset: -30, expandedGroupIds: [], followLatest: false };
        let resolveRead!: (state: ReadingState) => void;
        const read = new Promise<ReadingState>((resolve) => { resolveRead = resolve; });
        const scrollToOffset = vi.fn();
        const listeners = new Map<string, (event: any) => void>();
        const node = {
            scrollTop: 100,
            addEventListener: vi.fn((type: string, listener: (event: any) => void) => listeners.set(type, listener)),
            removeEventListener: vi.fn((type: string, listener: (event: any) => void) => {
                if (listeners.get(type) === listener) listeners.delete(type);
            }),
        };
        const adapter = {
            key: 'owner/session', read: () => read, save: vi.fn(),
            wireId: (id: string) => id.replace(/-replayed$/, ''), wireSeq: () => 2,
        };
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <ConversationTranscript metadata={null} messages={[userMessage('wire2-replayed')]}
                    reading={adapter} isAtLatest={false} />,
                { createNodeMock: (element: any) => element.type === 'FlatList'
                    ? { ...node, getScrollableNode: () => node, scrollToOffset, scrollToIndex: vi.fn() }
                    : { measureInWindow: (cb: any) => cb(0, element.props.onLayout ? 150 : 100, 800, 200) } },
            );
        });
        expect(node.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
        const wheel = listeners.get('wheel');
        expect(wheel).toBeDefined();
        wheel!({ shiftKey: false, deltaX: 0, deltaY: 120, preventDefault: vi.fn() });
        const preventDefault = vi.fn();
        wheel!({ shiftKey: true, deltaX: 40, deltaY: 0, preventDefault });
        expect(node.scrollTop).toBe(140);
        expect(preventDefault).toHaveBeenCalledOnce();
        await act(async () => { resolveRead(saved); await read; });
        await act(async () => { byId(renderer, 'conversation-transcript-list').props.onContentSizeChange(100, 2000); });
        expect(scrollToOffset).not.toHaveBeenCalled();
        act(() => renderer.unmount());
        expect(node.removeEventListener).toHaveBeenCalledWith('wheel', wheel);
        expect(listeners.has('wheel')).toBe(false);
    });

    it('does not register the Web wheel listener on native platforms', async () => {
        (Platform as any).OS = 'ios';
        const node = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<ConversationTranscript metadata={null} messages={[]} />, {
                createNodeMock: (element: any) => element.type === 'FlatList' ? { getScrollableNode: () => node } : null,
            });
        });
        expect(node.addEventListener).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('loads older history after native initial loading leaves the transcript shorter than its viewport', async () => {
        (Platform as any).OS = 'android';
        const onLoadOlder = vi.fn();
        const messages = [userMessage('latest')];
        const render = (loading: boolean) => (
            <ConversationTranscript metadata={null} sessionId="session" messages={messages}
                hasMoreOlder isLoadingOlder={loading} onLoadOlder={onLoadOlder} />
        );
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render(true)); });
        const list = byId(renderer, 'conversation-transcript-list');
        expect(typeof list.props.onLayout).toBe('function');
        act(() => {
            list.props.onLayout({ nativeEvent: { layout: { height: 800 } } });
            list.props.onContentSizeChange(400, 320);
        });
        expect(onLoadOlder).not.toHaveBeenCalled();

        await act(async () => { renderer.update(render(false)); });
        expect(onLoadOlder).toHaveBeenCalledOnce();
        act(() => renderer.unmount());
    });

    it('waits for a fresh native measurement when newer content changes but the oldest boundary stays the same', async () => {
        (Platform as any).OS = 'android';
        const onLoadOlder = vi.fn();
        const render = (messages: Message[], loading: boolean) => (
            <ConversationTranscript metadata={null} sessionId="session" messages={messages}
                hasMoreOlder isLoadingOlder={loading} onLoadOlder={onLoadOlder} />
        );
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render([userMessage('latest')], true)); });
        const list = byId(renderer, 'conversation-transcript-list');
        act(() => {
            list.props.onLayout({ nativeEvent: { layout: { height: 800 } } });
            list.props.onContentSizeChange(400, 320);
        });

        const withNewerContent = [userMessage('new-latest'), userMessage('latest')];
        await act(async () => { renderer.update(render(withNewerContent, true)); });
        await act(async () => { renderer.update(render(withNewerContent, false)); });
        expect(onLoadOlder).not.toHaveBeenCalled();

        act(() => byId(renderer, 'conversation-transcript-list').props.onContentSizeChange(400, 900));
        expect(onLoadOlder).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('reuses an underfilled native measurement after same-height content settles without a size callback', async () => {
        (Platform as any).OS = 'android';
        const onLoadOlder = vi.fn();
        const render = (messages: Message[], loading: boolean) => (
            <ConversationTranscript metadata={null} sessionId="session" messages={messages}
                hasMoreOlder isLoadingOlder={loading} onLoadOlder={onLoadOlder} />
        );
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render([userMessage('latest')], true)); });
        act(() => {
            const list = byId(renderer, 'conversation-transcript-list');
            list.props.onLayout({ nativeEvent: { layout: { height: 800 } } });
            list.props.onContentSizeChange(400, 320);
        });

        const sameHeightReplacement = [userMessage('latest')];
        await act(async () => { renderer.update(render(sameHeightReplacement, true)); });
        await flushFrame();
        await flushFrame();
        await act(async () => { renderer.update(render(sameHeightReplacement, false)); });
        expect(onLoadOlder).toHaveBeenCalledOnce();
        act(() => renderer.unmount());
    });

    it('waits for a delayed taller native measurement instead of promoting by elapsed wall time', async () => {
        vi.useFakeTimers();
        installFrameQueue();
        (Platform as any).OS = 'android';
        const onLoadOlder = vi.fn();
        const render = (messages: Message[], loading: boolean) => (
            <ConversationTranscript metadata={null} sessionId="session" messages={messages}
                hasMoreOlder isLoadingOlder={loading} onLoadOlder={onLoadOlder} />
        );
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render([userMessage('latest')], true)); });
        act(() => {
            const list = byId(renderer, 'conversation-transcript-list');
            list.props.onLayout({ nativeEvent: { layout: { height: 800 } } });
            list.props.onContentSizeChange(400, 320);
        });

        const tallerContent = [userMessage('new-latest'), userMessage('latest')];
        await act(async () => { renderer.update(render(tallerContent, true)); });
        await act(async () => { vi.advanceTimersByTime(50); });
        await act(async () => { renderer.update(render(tallerContent, false)); });
        expect(onLoadOlder).not.toHaveBeenCalled();
        act(() => byId(renderer, 'conversation-transcript-list').props.onContentSizeChange(400, 900));
        expect(onLoadOlder).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('loads consecutive underfilled native pages and stops when older history is exhausted', async () => {
        (Platform as any).OS = 'android';
        const onLoadOlder = vi.fn();
        const render = (messages: Message[], loading: boolean, hasMore = true) => (
            <ConversationTranscript metadata={null} sessionId="session" messages={messages}
                hasMoreOlder={hasMore} isLoadingOlder={loading} onLoadOlder={onLoadOlder} />
        );
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render([userMessage('latest')], false)); });
        act(() => {
            const list = byId(renderer, 'conversation-transcript-list');
            list.props.onLayout({ nativeEvent: { layout: { height: 800 } } });
            list.props.onContentSizeChange(400, 240);
        });
        expect(onLoadOlder).toHaveBeenCalledTimes(1);

        const firstPage = [userMessage('latest'), userMessage('older-1')];
        await act(async () => { renderer.update(render(firstPage, true)); });
        await act(async () => { renderer.update(render(firstPage, false)); });
        expect(onLoadOlder).toHaveBeenCalledTimes(1);
        act(() => byId(renderer, 'conversation-transcript-list').props.onContentSizeChange(400, 520));
        expect(onLoadOlder).toHaveBeenCalledTimes(2);

        const exhausted = [...firstPage, userMessage('oldest')];
        await act(async () => { renderer.update(render(exhausted, true)); });
        await act(async () => { renderer.update(render(exhausted, false, false)); });
        act(() => byId(renderer, 'conversation-transcript-list').props.onContentSizeChange(400, 700));
        expect(onLoadOlder).toHaveBeenCalledTimes(2);
        act(() => renderer.unmount());
    });

    it('does not eagerly load an underfilled Web transcript', async () => {
        const onLoadOlder = vi.fn();
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <ConversationTranscript metadata={null} sessionId="session" messages={[userMessage('latest')]}
                    hasMoreOlder onLoadOlder={onLoadOlder} />,
            );
        });
        act(() => {
            const list = byId(renderer, 'conversation-transcript-list');
            list.props.onLayout({ nativeEvent: { layout: { height: 800 } } });
            list.props.onContentSizeChange(400, 240);
        });
        expect(onLoadOlder).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('waits for a fresh native content measurement before loading a changed history boundary', async () => {
        (Platform as any).OS = 'android';
        const onLoadOlder = vi.fn();
        const render = (messages: Message[]) => (
            <ConversationTranscript metadata={null} sessionId="session" messages={messages}
                hasMoreOlder onLoadOlder={onLoadOlder} />
        );
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render([userMessage('latest')])); });
        const list = byId(renderer, 'conversation-transcript-list');
        act(() => {
            list.props.onLayout({ nativeEvent: { layout: { height: 800 } } });
            list.props.onContentSizeChange(400, 320);
        });
        expect(onLoadOlder).toHaveBeenCalledOnce();

        await act(async () => { renderer.update(render([userMessage('latest'), userMessage('older')])); });
        expect(onLoadOlder).toHaveBeenCalledOnce();
        act(() => byId(renderer, 'conversation-transcript-list').props.onContentSizeChange(400, 900));
        expect(onLoadOlder).toHaveBeenCalledOnce();
        act(() => renderer.unmount());
    });

    it('does not load older native history when content exactly fills the viewport', async () => {
        (Platform as any).OS = 'android';
        const onLoadOlder = vi.fn();
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <ConversationTranscript metadata={null} sessionId="session" messages={[userMessage('latest')]}
                    hasMoreOlder onLoadOlder={onLoadOlder} />,
            );
        });
        const list = byId(renderer, 'conversation-transcript-list');
        act(() => {
            list.props.onLayout({ nativeEvent: { layout: { height: 800 } } });
            list.props.onContentSizeChange(400, 800);
        });
        expect(onLoadOlder).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('uses bounded non-inverted virtualization on Web and keeps native inversion', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<ConversationTranscript metadata={null} messages={[userMessage('web')]} />);
        });
        expect(byId(renderer, 'conversation-transcript-list').props.disableVirtualization).toBe(false);
        expect(byId(renderer, 'conversation-transcript-list').props.inverted).toBe(false);
        expect(byId(renderer, 'conversation-transcript-list').props.windowSize).toBe(5);

        await act(async () => {
            renderer.update(<ConversationTranscript metadata={null} messages={[userMessage('public')]} inverted={false} />);
        });
        expect(byId(renderer, 'conversation-transcript-list').props.disableVirtualization).toBe(false);

        (Platform as any).OS = 'ios';
        await act(async () => {
            renderer.update(<ConversationTranscript metadata={null} messages={[userMessage('native')]} />);
        });
        expect(byId(renderer, 'conversation-transcript-list').props.disableVirtualization).toBe(false);
        expect(byId(renderer, 'conversation-transcript-list').props.inverted).toBe(true);
        act(() => renderer.unmount());
    });

    it('exposes unmeasured Web targets and replaces estimates with bounded row measurements', async () => {
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<ConversationTranscript metadata={null}
            messages={[userMessage('new'), userMessage('old')]} />); });
        let list = byId(renderer, 'conversation-transcript-list');
        expect(list.props.getItemLayout(list.props.data, 1)).toMatchObject({ index: 1, offset: 160, length: 160 });
        const row = list.props.renderItem({ item: list.props.data[0] });
        act(() => row.props.onLayout({ nativeEvent: { layout: { height: 321 } } }));
        list = byId(renderer, 'conversation-transcript-list');
        expect(list.props.getItemLayout(list.props.data, 1)).toMatchObject({ offset: 321 });
        act(() => list.props.onLayout({ nativeEvent: { layout: { width: 600, height: 800 } } }));
        list = byId(renderer, 'conversation-transcript-list');
        expect(list.props.getItemLayout(list.props.data, 1)).toMatchObject({ offset: 160 });
        act(() => renderer.unmount());
    });

    it('preserves an image row key through pagination without expanding the synchronous render region', async () => {
        grouped.items = Array.from({ length: 15 }, (_, index) => ({
            type: 'message',
            id: `before-${index}`,
            message: userMessage(`before-${index}`),
        }));
        grouped.items[14] = {
            type: 'image-group',
            id: 'stable-image',
            messages: [userMessage('stable-image')],
            presentation: 'compact',
            pendingCount: 0,
        };
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<ConversationTranscript metadata={null} messages={[]} />);
        });
        const beforeList = byId(renderer, 'conversation-transcript-list');
        const imageKey = beforeList.props.keyExtractor(beforeList.props.data.find((item: any) => item.id === 'stable-image'));
        expect(beforeList.props.initialNumToRender).toBe(10);

        grouped.items = [
            ...grouped.items.slice(0, 7),
            ...Array.from({ length: 4 }, (_, index) => ({
                type: 'message',
                id: `inserted-${index}`,
                message: userMessage(`inserted-${index}`),
            })),
            ...grouped.items.slice(7),
        ];
        await act(async () => {
            renderer.update(<ConversationTranscript metadata={null} messages={[userMessage('pagination')]} />);
        });

        const afterList = byId(renderer, 'conversation-transcript-list');
        expect(afterList.props.initialNumToRender).toBe(10);
        expect(afterList.props.keyExtractor(afterList.props.data.find((item: any) => item.id === 'stable-image'))).toBe(imageKey);
        act(() => renderer.unmount());
    });

    it('does not force an eager full render for a Web transcript without image rows', async () => {
        grouped.items = Array.from({ length: 15 }, (_, index) => ({
            type: 'message',
            id: `text-${index}`,
            message: userMessage(`text-${index}`),
        }));
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<ConversationTranscript metadata={null} messages={[]} />);
        });

        expect(byId(renderer, 'conversation-transcript-list').props.initialNumToRender).toBe(10);
        act(() => renderer.unmount());
    });

    it('hides standalone browser evidence from the transcript before its invocation loads', async () => {
        const invoke: Message = { kind: 'tool-call', id: 'skill', localId: null, createdAt: 1, children: [],
            tool: { name: 'Skill', input: { skill: 'ego-browser' }, state: 'completed', createdAt: 1, startedAt: 1, completedAt: 1, description: null } };
        const frame: Message = { ...invoke, id: 'frame', createdAt: 2, tool: { ...invoke.tool,
            name: 'file', input: { ref: 'frame.png', name: 'frame.png', source: 'browser_step', browserStep: { label: 'Verified', runId: 'run', skillName: 'ego-browser' } } } };
        const reference: Message = { ...frame, id: 'reference', tool: { ...frame.tool, input: { ref: 'ref.png', name: 'ref.png', source: 'user' } } };
        let renderer: any;
        const render = (messages: Message[], sessionId: string | undefined = 'session') => <ConversationTranscript metadata={null} sessionId={sessionId} messages={messages} groupToolCalls={false} />;
        await act(async () => { renderer = TestRenderer.create(render([frame, reference])); });
        const ids = () => byId(renderer, 'conversation-transcript-list').props.data.map((item: any) => item.id);
        // A complete browser-step identity is sufficient to form a standalone
        // Browser Steps run.  Do not duplicate its frame in the transcript
        // while the matching Skill invocation is still loading.
        expect(ids()).toEqual(['reference']);
        act(() => renderer.update(render([frame, reference, invoke])));
        expect(ids()).toEqual(['skill', 'reference']);
        act(() => renderer.update(<ConversationTranscript metadata={null} messages={[frame, reference, invoke]} groupToolCalls={false} />));
        expect(ids()).toEqual(['skill', 'reference', 'frame']);
        act(() => renderer.unmount());
    });

    it('preserves React row keys across history replay without conflating blocks of one wire message', async () => {
        const reading = { key: 'session', read: async () => null, save: vi.fn(),
            wireId: () => 'same-wire', wireSeq: () => 1,
            blockKey: (id: string) => id.endsWith('second') ? 'text:1' : 'text:0' };
        const render = (prefix: string) => <ConversationTranscript metadata={null}
            messages={[userMessage(`${prefix}-first`), userMessage(`${prefix}-second`)]} reading={reading} />;
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render('original')); });
        const keys = () => {
            const list = renderer.root.findByType('FlatList');
            return list.props.data.map(list.props.keyExtractor);
        };
        const before = keys();
        expect(new Set(before).size).toBe(2);
        await act(async () => { renderer.update(render('replayed')); });
        expect(keys()).toEqual(before);
        act(() => renderer.unmount());
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
        act(() => list.props.onStartReached());
        expect(onLoadOlder).not.toHaveBeenCalled();
        act(() => reachOlder(list));
        expect(onLoadOlder).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });

    it('does not retry the same older wire boundary when history replay changes reducer ids', async () => {
        const onLoadOlder = vi.fn();
        const reading = {
            key: 'session', read: async () => null, save: vi.fn(),
            wireId: (id: string) => id.replace('-replayed', ''),
            wireSeq: () => 1,
        };
        const render = (id: string) => (
            <ConversationTranscript metadata={null} sessionId="session" messages={[userMessage(id)]}
                reading={reading} hasMoreOlder onLoadOlder={onLoadOlder} />
        );
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render('oldest')); });
        act(() => reachOlder(byId(renderer, 'conversation-transcript-list')));
        expect(onLoadOlder).toHaveBeenCalledTimes(1);

        act(() => renderer.update(render('oldest-replayed')));
        act(() => reachOlder(byId(renderer, 'conversation-transcript-list')));
        expect(onLoadOlder).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });

    it('lets a new Web wheel retry an older boundary whose previous load made no progress', async () => {
        const onLoadOlder = vi.fn();
        const listeners = new Map<string, (event: any) => void>();
        const node = {
            scrollTop: 0,
            scrollHeight: 2000,
            clientHeight: 800,
            addEventListener: vi.fn((type: string, listener: (event: any) => void) => listeners.set(type, listener)),
            removeEventListener: vi.fn(),
        };
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <ConversationTranscript metadata={null} sessionId="session" messages={[userMessage('oldest')]}
                    hasMoreOlder onLoadOlder={onLoadOlder} />,
                { createNodeMock: (element: any) => element.type === 'FlatList'
                    ? { ...node, getScrollableNode: () => node }
                    : null },
            );
        });
        const list = byId(renderer, 'conversation-transcript-list');
        act(() => reachOlder(list));
        act(() => reachOlder(list));
        expect(onLoadOlder).toHaveBeenCalledTimes(1);

        act(() => listeners.get('wheel')!({ shiftKey: false, deltaX: 0, deltaY: -120, preventDefault: vi.fn() }));
        expect(onLoadOlder).toHaveBeenCalledTimes(2);
        act(() => renderer.unmount());
    });

    it('uses the current transcript direction when wheel retries after an in-place layout change', async () => {
        const onLoadOlder = vi.fn();
        const listeners = new Map<string, (event: any) => void>();
        const node = {
            scrollTop: 1200,
            scrollHeight: 2000,
            clientHeight: 800,
            addEventListener: vi.fn((type: string, listener: (event: any) => void) => listeners.set(type, listener)),
            removeEventListener: vi.fn(),
        };
        const render = (inverted: boolean) => (
            <ConversationTranscript metadata={null} sessionId="session" messages={[userMessage('oldest')]}
                inverted={inverted} hasMoreOlder onLoadOlder={onLoadOlder} />
        );
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(render(true), {
                createNodeMock: (element: any) => element.type === 'FlatList'
                    ? { ...node, getScrollableNode: () => node }
                    : null,
            });
        });
        act(() => renderer.update(render(false)));
        node.scrollTop = 0;
        act(() => listeners.get('wheel')!({ shiftKey: false, deltaX: 0, deltaY: -120, preventDefault: vi.fn() }));
        expect(onLoadOlder).toHaveBeenCalledOnce();
        act(() => renderer.unmount());
    });

    it('uses the current history adapter when boundary identity changes without new messages', async () => {
        const onLoadOlder = vi.fn();
        const messages = [userMessage('rendered-oldest')];
        const adapter = (wireId: string) => ({
            key: wireId,
            read: async () => null,
            save: vi.fn(),
            wireId: () => wireId,
            wireSeq: () => 1,
        });
        const render = (reading: ReturnType<typeof adapter>) => (
            <ConversationTranscript metadata={null} sessionId="session" messages={messages}
                reading={reading} hasMoreOlder onLoadOlder={onLoadOlder} />
        );
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render(adapter('wire-a'))); });
        act(() => reachOlder(byId(renderer, 'conversation-transcript-list')));
        expect(onLoadOlder).toHaveBeenCalledTimes(1);

        act(() => renderer.update(render(adapter('wire-b'))));
        act(() => reachOlder(byId(renderer, 'conversation-transcript-list')));
        expect(onLoadOlder).toHaveBeenCalledTimes(2);
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

    it('keeps background loading hidden and shows delayed boundary loading without adding list height', async () => {
        vi.useFakeTimers();
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<ConversationTranscript metadata={null} messages={[userMessage('u')]}
            hasMoreOlder isLoadingOlder />); });
        await act(async () => { vi.advanceTimersByTime(500); });
        expect(renderer.root.findAllByProps({ testID: 'history-older-loading' })).toHaveLength(0);
        act(() => byId(renderer, 'conversation-transcript-list').props.onScroll({ nativeEvent: {
            contentOffset: { y: 0 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 800 },
        } }));
        expect(renderer.root.findAllByProps({ testID: 'history-older-loading' })).toHaveLength(0);
        await act(async () => { vi.advanceTimersByTime(300); });
        expect(byId(renderer, 'history-older-loading')).toBeDefined();
        expect(byId(renderer, 'conversation-transcript-list').props.ListFooterComponent).toBeUndefined();
        act(() => renderer.unmount()); vi.useRealTimers();
    });

    it.each([true, false])('loads newer at the historical visual bottom only once per boundary (inverted=%s)', async inverted => {
        const newer = vi.fn(); const older = vi.fn();
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<ConversationTranscript metadata={null} messages={[userMessage('old')]}
            inverted={inverted} isAtLatest={false} hasMoreNewer onLoadNewer={newer} onLoadOlder={older} />); });
        const list = byId(renderer, 'conversation-transcript-list');
        act(() => { list.props.onScrollBeginDrag(); for (let i = 0; i < 3; i++) list.props.onScroll({ nativeEvent: {
            contentOffset: { y: inverted ? 0 : 1200 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 800 },
        } }); });
        expect(newer).toHaveBeenCalledOnce();
        expect(older).not.toHaveBeenCalled();
        expect(list.props.maintainVisibleContentPosition?.autoscrollToTopThreshold).toBeUndefined();
        act(() => renderer.unmount());
    });

    it('selects latest before scrolling from a historical window', async () => {
        let finish!: () => void;
        const jump = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        const scrollToEnd = vi.fn(); let renderer: any;
        const render = (latest: boolean) => <ConversationTranscript metadata={null} messages={[userMessage(latest ? 'new' : 'old')]}
            isAtLatest={latest} onJumpToLatest={jump} />;
        await act(async () => { renderer = TestRenderer.create(render(false), { createNodeMock: () => ({ scrollToEnd }) }); });
        act(() => byId(renderer, 'conversation-scroll-to-bottom').props.onPress());
        expect(jump).toHaveBeenCalledOnce(); expect(scrollToEnd).not.toHaveBeenCalled();
        await act(async () => { finish(); renderer.update(render(true)); });
        act(() => byId(renderer, 'conversation-transcript-list').props.onContentSizeChange(100, 2000));
        expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
        act(() => renderer.unmount());
    });

    it('gates current-turn, footer and latest edit controls in a historical ChatList', async () => {
        Object.assign(sessionState, { isAtLatest: false }); let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<ChatList session={{ id: 'session', metadata: null } as any} />); });
        const transcript = renderer.root.findByType((ConversationTranscript as any).type).props;
        expect(transcript.currentTurnActive).toBe(false);
        expect(transcript.canEditLatestUserMessage).toBe(false);
        expect(transcript.visualBottom).toBeNull();
        act(() => renderer.unmount()); Object.assign(sessionState, { isAtLatest: true });
    });

    it('offers explicit retry only at a failed reached boundary', async () => {
        const retry = vi.fn(); let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<ConversationTranscript metadata={null} messages={[userMessage('u')]}
            hasMoreOlder olderError="offline" onLoadOlder={retry} />); });
        expect(renderer.root.findAllByProps({ testID: 'history-older-retry' })).toHaveLength(0);
        act(() => byId(renderer, 'conversation-transcript-list').props.onScroll({ nativeEvent: {
            contentOffset: { y: 0 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 800 },
        } }));
        expect(retry).not.toHaveBeenCalled();
        act(() => byId(renderer, 'history-older-retry').props.onPress());
        expect(retry).toHaveBeenCalledOnce(); act(() => renderer.unmount());
    });

    it('cancels estimated anchor-scroll retries after switching sessions', async () => {
        vi.useFakeTimers(); const scrollToIndex = vi.fn(); let renderer: any;
        const render = (id: string) => <ConversationTranscript metadata={null} sessionId={id} messages={[userMessage('u')]} />;
        await act(async () => { renderer = TestRenderer.create(render('a'), {
            createNodeMock: (element: any) => element.type === 'FlatList' ? { scrollToIndex, scrollToOffset: vi.fn() } : null,
        }); });
        act(() => byId(renderer, 'conversation-transcript-list').props.onScrollToIndexFailed({ index: 0, averageItemLength: 200 }));
        act(() => renderer.update(render('b')));
        await act(async () => { vi.advanceTimersByTime(500); });
        expect(scrollToIndex).not.toHaveBeenCalled();
        act(() => renderer.unmount()); vi.useRealTimers();
    });

    it('persists expanded A/B/C through trimming A, then persists manual collapse when reopening', async () => {
        const group = (id: string, ids: string[]) => ({ type: 'tool-group', id, messages: ids.map(userMessage), hasRunning: false, hasPendingPermission: false });
        grouped.items = [group('random-original', ['A', 'B', 'C'])];
        let saved: any = { version: 1, anchorId: 'B', anchorSeq: 2, offset: 0, expandedGroupIds: [], followLatest: false };
        const adapter = { key: 'owner/session', read: async () => saved, save: (value: any) => { saved = value; }, wireId: (id: string) => id, wireSeq: () => 2 };
        const render = () => <ConversationTranscript metadata={null} sessionId="session" messages={grouped.items![0].messages}
            reading={adapter} isAtLatest={false} />;
        const row = (renderer: any) => {
            const list = byId(renderer, 'conversation-transcript-list');
            return list.props.renderItem({ item: list.props.data[0] }).props.children.props.children.props;
        };
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(render()); });
        expect(row(renderer).expanded).toBe(false);
        act(() => row(renderer).onToggle()); expect(row(renderer).expanded).toBe(true);
        grouped.items = [group('random-trimmed', ['B', 'C'])];
        act(() => renderer.update(render())); expect(row(renderer).expanded).toBe(true);
        act(() => row(renderer).onToggle()); expect(row(renderer).expanded).toBe(false);
        act(() => renderer.unmount());
        grouped.items = [group('random-reopened', ['A', 'B', 'C'])];
        await act(async () => { renderer = TestRenderer.create(render()); });
        expect(row(renderer).expanded).toBe(false);
        act(() => renderer.unmount()); grouped.items = null;
    });
});
