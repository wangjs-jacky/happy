import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, ToolCallMessage } from './typesMessage';
import { collectSessionImageGallery } from './sessionImageGallery';
import { openSessionImageViewer } from './openSessionImageViewer';
import { useImageViewerStore } from './imageViewer';

const state = vi.hoisted(() => ({ sessionMessages: {} as Record<string, { messages: Message[] }> }));
vi.mock('./storage', () => ({ storage: { getState: () => state } }));

function file(id: string, createdAt: number, kind?: string): ToolCallMessage {
    return { id, createdAt, kind: 'tool-call', localId: null, children: [], tool: {
        name: 'file', state: 'completed', input: { ref: id, name: `${id}.png`, kind },
        createdAt, startedAt: null, completedAt: createdAt, description: null,
    } };
}

describe('session image history', () => {
    beforeEach(() => {
        state.sessionMessages = {};
        useImageViewerStore.setState({ visible: false, sources: [], index: 0 });
    });

    it('includes earlier unmounted and unresolved images in time order, filters media and deduplicates nested files', () => {
        const first = file('first', 1, 'image');
        const last = file('last', 9);
        last.children = [first];
        const sources = collectSessionImageGallery('s1', [last, file('video', 8, 'video'), first, file('pdf', 2, 'file')]);
        expect(sources.map((source) => source.attachmentRef)).toEqual(['first', 'last']);
        expect(sources.every((source) => source.sessionId === 's1' && source.uri === '')).toBe(true);
    });

    it('opens the tapped image within the current session history and preserves its resolved source', () => {
        state.sessionMessages.s1 = { messages: [file('last', 9), file('first', 1)] };
        state.sessionMessages.other = { messages: [file('private-other-session', 2)] };
        openSessionImageViewer({ uri: 'blob:last', sessionId: 's1', attachmentRef: 'last', filename: 'last.png' });
        const viewer = useImageViewerStore.getState();
        expect(viewer.index).toBe(1);
        expect(viewer.sources.map((source) => source.attachmentRef)).toEqual(['first', 'last']);
        expect(viewer.sources[1].uri).toBe('blob:last');
    });

    it('matches chat display order for a batch with identical timestamps', () => {
        const sources = collectSessionImageGallery('s1', [file('third', 1), file('second', 1), file('first', 1)]);
        expect(sources.map((source) => source.attachmentRef)).toEqual(['first', 'second', 'third']);
    });

    it('retains newly arrived images missing from history and falls back for standalone galleries', () => {
        state.sessionMessages.s1 = { messages: [file('first', 1)] };
        openSessionImageViewer({ uri: 'blob:new', sessionId: 's1', attachmentRef: 'new' });
        expect(useImageViewerStore.getState().index).toBe(1);
        openSessionImageViewer([{ uri: 'a' }, { uri: 'b' }], 1);
        expect(useImageViewerStore.getState().sources).toEqual([{ uri: 'a' }, { uri: 'b' }]);
        expect(useImageViewerStore.getState().index).toBe(1);
    });
});
