import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRelationshipAdvisorChat } from './useRelationshipAdvisorChat';

// @ts-expect-error react-test-renderer does not publish declarations used by this narrow test.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    conversations: [{
        id: 'conversation-1',
        title: 'New conversation',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
    }],
    updateConversations: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    uploadImages: vi.fn(),
    discardImages: vi.fn(),
    saveImages: vi.fn(),
    uploadHistory: vi.fn(),
    deleteCached: vi.fn(),
    requestIndex: 0,
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => `request-${++mocks.requestIndex}` }));
vi.mock('@/sync/relationshipAdvisorImageCache', () => ({ deleteAdvisorImages: mocks.deleteCached }));
vi.mock('@/sync/storage', () => ({
    useLocalSetting: () => mocks.conversations,
    useLocalSettingUpdater: () => mocks.updateConversations,
}));
vi.mock('@/sync/relationshipAdvisorClient', () => ({
    relationshipAdvisorClient: {
        start: mocks.start,
        cancel: mocks.cancel,
    },
}));
vi.mock('@/sync/relationshipAdvisorImages', () => ({
    uploadRelationshipAdvisorImages: mocks.uploadImages,
    discardRelationshipAdvisorImages: mocks.discardImages,
    saveRelationshipAdvisorImages: mocks.saveImages,
    uploadRelationshipAdvisorHistory: mocks.uploadHistory,
    relationshipAdvisorImageKeys: (_request: string, images: unknown[]) => images.map(() => 'cached-image.jpg'),
}));

type HookResult = ReturnType<typeof useRelationshipAdvisorChat>;

function renderHook(): { current: () => HookResult; unmount: () => void } {
    let result: HookResult | undefined;
    let renderer: { unmount: () => void } | undefined;
    function Harness() {
        result = useRelationshipAdvisorChat('conversation-1');
        return null;
    }
    act(() => {
        renderer = TestRenderer.create(<Harness />);
    });
    return {
        current: () => {
            if (!result) throw new Error('Hook did not render');
            return result;
        },
        unmount: () => act(() => renderer?.unmount()),
    };
}

describe('useRelationshipAdvisorChat', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.requestIndex = 0;
        mocks.deleteCached.mockResolvedValue(undefined);
        mocks.conversations = [{ id: 'conversation-1', title: 'New conversation', createdAt: 1, updatedAt: 1, messages: [] }];
        mocks.saveImages.mockResolvedValue(['cached-image.jpg']);
        mocks.uploadHistory.mockImplementation(async (messages) => messages);
        mocks.uploadImages.mockResolvedValue([]);
        mocks.discardImages.mockResolvedValue(undefined);
        mocks.updateConversations.mockImplementation((updater: (value: typeof mocks.conversations) => typeof mocks.conversations) => {
            mocks.conversations = updater(mocks.conversations);
        });
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('tracks the replacement user identity after a failed local save and subsequent retry failure', async () => {
        mocks.saveImages.mockRejectedValueOnce(new Error('local storage failed'));
        mocks.start.mockImplementation(async (request, onEvent) => {
            onEvent({ requestId: request.requestId, type: 'error', error: 'failed' });
            return vi.fn();
        });
        const hook = renderHook();
        await act(async () => { await hook.current().send('看图', [{ id: 'one' }] as any); });
        expect(hook.current().messages).toHaveLength(0);
        await act(async () => { await hook.current().retry(); });
        await act(async () => { await hook.current().retry(); });
        expect(hook.current().messages).toHaveLength(1);
        expect(hook.current().messages[0].id).toBe('user-request-2');
        expect(mocks.uploadHistory.mock.calls[1][0]).toHaveLength(1);
        hook.unmount();
    });

    it('retries a partial response on the original user message without duplicating its images', async () => {
        const images = Array.from({ length: 4 }, (_, index) => ({ id: String(index) })) as any;
        mocks.start.mockImplementation(async (request, onEvent) => {
            onEvent({ requestId: request.requestId, type: 'delta', text: '部分回复' });
            onEvent({ requestId: request.requestId, type: 'error', error: 'failed' });
            return vi.fn();
        });
        const hook = renderHook();
        await act(async () => { await hook.current().send('看图', images); });
        expect(hook.current().canRetry).toBe(true);
        await act(async () => { await hook.current().retry(); });
        expect(mocks.uploadHistory.mock.calls[1][0]).toHaveLength(1);
        expect(hook.current().messages.filter((message) => message.role === 'user')).toHaveLength(1);
        expect(mocks.saveImages).toHaveBeenCalledTimes(1);
        hook.unmount();
    });

    it('keeps the original images when a retry is stopped during upload', async () => {
        mocks.start.mockImplementation(async (request, onEvent) => {
            onEvent({ requestId: request.requestId, type: 'error', error: 'empty_response' });
            return vi.fn();
        });
        const hook = renderHook();
        await act(async () => { await hook.current().send('看图', [{ id: 'one' }] as any); });
        let finishUpload: (result: null) => void = () => undefined;
        mocks.uploadHistory.mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve; }));
        let pending: Promise<boolean>;
        act(() => { pending = hook.current().retry(); });
        act(() => hook.current().cancel());
        await act(async () => { finishUpload(null); await pending!; });
        expect(mocks.deleteCached).not.toHaveBeenCalled();
        expect(hook.current().messages[0]).toMatchObject({ imageKeys: ['cached-image.jpg'] });
        hook.unmount();
    });

    it('retains images for a follow-up after reopening the conversation', async () => {
        mocks.conversations[0].messages = [{
            id: 'previous-image', role: 'user', text: '', createdAt: 2, imageCount: 1,
            imageKeys: ['cached-image.jpg'],
        }] as any;
        mocks.start.mockImplementation(async (request, onEvent) => {
            onEvent({ requestId: request.requestId, type: 'delta', text: '看到了' });
            onEvent({ requestId: request.requestId, type: 'done' });
            return vi.fn();
        });
        const hook = renderHook();
        await act(async () => { await hook.current().send('刚才那张截图呢', []); });
        expect(mocks.uploadHistory.mock.calls[0]?.[0][0]).toMatchObject({ imageKeys: ['cached-image.jpg'] });
        hook.unmount();
    });

    it('unsubscribes when the provider acknowledgement resolves after unmount', async () => {
        let resolveStart: (unsubscribe: () => void) => void = () => undefined;
        const unsubscribe = vi.fn();
        mocks.start.mockReturnValue(new Promise<() => void>((resolve) => {
            resolveStart = resolve;
        }));
        const hook = renderHook();

        let sendPromise: Promise<boolean>;
        act(() => {
            sendPromise = hook.current().send('hello', []);
        });
        await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
        hook.unmount();
        await act(async () => {
            resolveStart(unsubscribe);
            await sendPromise!;
        });

        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(mocks.cancel).toHaveBeenCalledWith('request-1');
    });

    it('settles a provider rejection after unmount without retaining the request', async () => {
        let rejectStart: (error: Error) => void = () => undefined;
        mocks.start.mockReturnValue(new Promise<() => void>((_resolve, reject) => {
            rejectStart = reject;
        }));
        const hook = renderHook();

        let sendPromise: Promise<boolean>;
        act(() => {
            sendPromise = hook.current().send('hello', []);
        });
        await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
        hook.unmount();
        await act(async () => {
            rejectStart(new Error('late rejection'));
            await expect(sendPromise!).resolves.toBe(false);
        });

        expect(mocks.cancel).toHaveBeenCalledWith('request-1');
    });
});
