import { beforeEach, expect, it, vi } from 'vitest';
import { loadEarlierSessionImages } from './loadEarlierSessionImages';

const fixture = vi.hoisted(() => ({ state: { sessionMessages: {} as Record<string, any> }, load: vi.fn(), listeners: new Set<(state: any) => void>() }));
vi.mock('./storage', () => ({ storage: {
    getState: () => fixture.state,
    subscribe: (listener: (state: any) => void) => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); },
} }));
vi.mock('./sync', () => ({ sync: { loadOlderMessages: fixture.load } }));
const file = (id: string, createdAt: number) => ({ id, createdAt, kind: 'tool-call', children: [], tool: { name: 'file', input: { ref: id, name: `${id}.png` } } });
const current = [{ uri: 'blob:new', sessionId: 's1', attachmentRef: 'new' }];

beforeEach(() => {
    fixture.load.mockReset();
    fixture.listeners.clear();
    fixture.state.sessionMessages = { s1: { messages: [file('new', 3)], hasMoreOlder: true, isLoadingOlder: false } };
});

it('passes text-only pages to find an earlier image and preserves the resolved current source', async () => {
    fixture.load.mockImplementationOnce(async () => {
        fixture.state.sessionMessages.s1.messages = [file('new', 3), { kind: 'user-text', id: 'text', createdAt: 2 }];
    }).mockImplementationOnce(async () => {
        fixture.state.sessionMessages.s1 = { messages: [file('new', 3), file('old', 1)], hasMoreOlder: false };
    });
    const result = await loadEarlierSessionImages(current, new AbortController().signal);
    expect(result.map(source => source.attachmentRef)).toEqual(['old', 'new']);
    expect(result[1].uri).toBe('blob:new');
    expect(fixture.load).toHaveBeenCalledTimes(2);
});

it('uses older images already loaded since opening without requesting another page', async () => {
    fixture.state.sessionMessages.s1.messages = [file('new', 3), file('old', 1)];
    expect((await loadEarlierSessionImages(current, new AbortController().signal))[0].attachmentRef).toBe('old');
    expect(fixture.load).not.toHaveBeenCalled();
});

it('stops at exhausted history and does not spin on a no-progress response', async () => {
    fixture.state.sessionMessages.s1.hasMoreOlder = false;
    expect(await loadEarlierSessionImages(current, new AbortController().signal)).toEqual(current);
    fixture.state.sessionMessages.s1.hasMoreOlder = true;
    fixture.load.mockResolvedValue(undefined);
    await expect(loadEarlierSessionImages(current, new AbortController().signal)).rejects.toThrow('progress');
    expect(fixture.load).toHaveBeenCalledTimes(1);
});

it('does not request another page after the viewer is closed', async () => {
    const controller = new AbortController();
    fixture.load.mockImplementationOnce(async () => {
        fixture.state.sessionMessages.s1.messages = [...fixture.state.sessionMessages.s1.messages];
        controller.abort();
    });
    await expect(loadEarlierSessionImages(current, controller.signal)).rejects.toThrow();
    expect(fixture.load).toHaveBeenCalledTimes(1);
});

it('waits for a concurrent chat page without duplicating it, then unsubscribes', async () => {
    fixture.state.sessionMessages.s1.isLoadingOlder = true;
    const pending = loadEarlierSessionImages(current, new AbortController().signal);
    expect(fixture.listeners.size).toBe(1);
    fixture.state.sessionMessages.s1 = { messages: [file('new', 3), file('old', 1)], hasMoreOlder: false, isLoadingOlder: false };
    fixture.listeners.forEach(listener => listener(fixture.state));
    expect((await pending)[0].attachmentRef).toBe('old');
    expect(fixture.load).not.toHaveBeenCalled();
    expect(fixture.listeners.size).toBe(0);
});

it('releases the subscription when closing during a concurrent chat page', async () => {
    fixture.state.sessionMessages.s1.isLoadingOlder = true;
    const controller = new AbortController();
    const pending = loadEarlierSessionImages(current, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(fixture.listeners.size).toBe(0);
    expect(fixture.load).not.toHaveBeenCalled();
});
