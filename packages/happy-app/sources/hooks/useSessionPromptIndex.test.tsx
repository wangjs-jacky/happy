import * as React from 'react';
import { act } from 'react';
// @ts-expect-error no local renderer declarations
import TestRenderer from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { useSessionPromptIndex } from './useSessionPromptIndex';
import { visibleSessionPrompts, mergeSessionPrompts, sessionPrompt, type SessionPromptNavigation, type SessionPromptPage } from '@/sync/sessionPromptIndex';
const prompt = (seq: number) => ({ id: `wire-${seq}`, seq, text: `prompt ${seq}`, createdAt: seq });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('accumulates independently paged prompts and keeps earlier directory entries selectable', async () => {
    const readPage = vi.fn().mockResolvedValueOnce({ prompts: [prompt(90)], beforeSeq: 80, hasMore: true })
        .mockResolvedValueOnce({ prompts: [prompt(20)], beforeSeq: 1, hasMore: false });
    const adapter: SessionPromptNavigation = { key: 'one', readPage, loadTarget: vi.fn() };
    let index!: ReturnType<typeof useSessionPromptIndex>;
    function Probe() { index = useSessionPromptIndex(adapter, true); return null; }
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(<Probe />); });
    expect(index.prompts.map(p => p.seq)).toEqual([90]);
    await act(async () => { await index.load(); });
    expect(index.prompts.map(p => p.seq)).toEqual([20, 90]);
    expect(readPage.mock.calls[1][0]).toBe(80);
    expect(index.hasMore).toBe(false);
    act(() => renderer.unmount());
});

it('drops delayed directory results after a session/account switch', async () => {
    let resolve!: (page: SessionPromptPage) => void;
    const pending = new Promise<SessionPromptPage>(done => { resolve = done; });
    const first: SessionPromptNavigation = { key: 'account-a/session', readPage: () => pending, loadTarget: vi.fn() };
    const second: SessionPromptNavigation = { key: 'account-b/session', readPage: async () => ({ prompts: [prompt(7)], beforeSeq: 1, hasMore: false }), loadTarget: vi.fn() };
    let index!: ReturnType<typeof useSessionPromptIndex>;
    function Probe({ adapter }: { adapter: SessionPromptNavigation }) { index = useSessionPromptIndex(adapter, true); return null; }
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(<Probe adapter={first} />); });
    await act(async () => { renderer.update(<Probe adapter={second} />); });
    await act(async () => { resolve({ prompts: [prompt(100)], beforeSeq: 10, hasMore: true }); await pending; });
    expect(index.prompts.map(p => p.seq)).toEqual([7]);
    expect(index.loading).toBe(false);
    act(() => renderer.unmount());
});

it('does not advance a failed cursor and permits an explicit retry', async () => {
    const readPage = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ prompts: [prompt(3)], beforeSeq: 1, hasMore: false });
    const adapter = { key: 'retry', readPage, loadTarget: vi.fn() };
    let index!: ReturnType<typeof useSessionPromptIndex>;
    function Probe() { index = useSessionPromptIndex(adapter, true); return null; }
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(<Probe />); });
    expect(index.error).toBe(true);
    expect(readPage).toHaveBeenCalledTimes(1);
    await act(async () => { await index.load(); });
    expect(readPage.mock.calls[1][0]).toBeUndefined();
    expect(index.error).toBe(false);
    act(() => renderer.unmount());
});

it('uses visible user text and deduplicates edited prompts across directory pages', () => {
    const edited = { ...prompt(20), editedFromMessageId: 'old-local' };
    expect(visibleSessionPrompts(mergeSessionPrompts([edited], [{ ...prompt(1), localId: 'old-local' }, edited]))).toEqual([edited]);
    expect(sessionPrompt({ id: 'wire', seq: 1 }, { id: 'normalized', localId: null, createdAt: 1, role: 'user', isSidechain: false,
        content: { type: 'text', text: '<!-- happy:system-prompt:start -->internal<!-- happy:system-prompt:end --> actual question' } })?.text).toBe('actual question');
});

it('retains edit tombstones when an edit chain spans three backwards pages', () => {
    let records = mergeSessionPrompts([], [{ ...prompt(3), editedFromMessageId: 'wire-2' }]);
    records = mergeSessionPrompts(records, [{ ...prompt(2), editedFromMessageId: 'wire-1' }]);
    records = mergeSessionPrompts(records, [prompt(1)]);
    expect(visibleSessionPrompts(records).map(row => row.seq)).toEqual([3]);
});

it('merges live prompts into an already completed directory without losing older pages', async () => {
    const adapter = { key: 'live', readPage: async () => ({ prompts: [prompt(1)], beforeSeq: 1, hasMore: false }), loadTarget: vi.fn() };
    let index!: ReturnType<typeof useSessionPromptIndex>;
    const empty: ReturnType<typeof prompt>[] = [];
    function Probe({ visible = empty }: { visible?: ReturnType<typeof prompt>[] }) { index = useSessionPromptIndex(adapter, true, visible); return null; }
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(<Probe />); });
    await act(async () => { renderer.update(<Probe visible={[prompt(2)]} />); });
    expect(index.prompts.map(row => row.seq)).toEqual([1, 2]);
    expect(index.hasMore).toBe(false);
    act(() => renderer.unmount());
});
