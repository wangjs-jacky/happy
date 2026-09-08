import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer does not publish declarations.
import TestRenderer from 'react-test-renderer';
import { useDraft } from './useDraft';

const state = vi.hoisted(() => ({
    focused: true,
    sessions: {} as Record<string, { draft: string | null }>,
    writes: [] as Array<[string, string | null]>,
    listeners: new Set<(state: string) => void>(),
}));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => state.focused }));
vi.mock('react-native', () => ({ AppState: { addEventListener: (_: string, fn: (state: string) => void) => {
    state.listeners.add(fn);
    return { remove: () => state.listeners.delete(fn) };
} } }));
vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({
    sessions: state.sessions,
    updateSessionDraft: (id: string, draft: string | null) => {
        state.writes.push([id, draft]);
        state.sessions[id] = { draft };
    },
}) } }));

describe('useDraft lifecycle', () => {
    let renderer: any;
    let controls: ReturnType<typeof useDraft>;
    const onChange = vi.fn();
    function Composer({ id = 'a', value }: { id?: string; value: string }) {
        controls = useDraft(id, value, onChange);
        return null;
    }
    const render = (value: string, id = 'a') => act(() => {
        const element = <Composer id={id} value={value} />;
        if (renderer) renderer.update(element);
        else renderer = TestRenderer.create(element);
    });
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        state.focused = true;
        state.sessions = { a: { draft: 'start' }, b: { draft: 'other' } };
        state.writes = [];
        state.listeners.clear();
        onChange.mockClear();
    });
    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
        vi.useRealTimers();
    });
    it('debounces continuing edits for two seconds without saving previous text on rerender', () => {
        render('start');
        render('first');
        act(() => vi.advanceTimersByTime(1000));
        render('latest');
        expect(state.writes).toEqual([]);
        act(() => vi.advanceTimersByTime(1999));
        expect(state.writes).toEqual([]);
        act(() => vi.advanceTimersByTime(1));
        expect(state.writes).toEqual([['a', 'latest']]);
    });
    it.each(['blur', 'background', 'inactive', 'unmount'])('flushes latest text on %s', (event) => {
        render('start');
        render('latest');
        act(() => {
            if (event === 'blur') { state.focused = false; render('latest'); }
            else if (event === 'unmount') { renderer.unmount(); renderer = undefined; }
            else state.listeners.forEach(fn => fn(event));
        });
        expect(state.writes).toEqual([['a', 'latest']]);
    });
    it('flushes the old session on switch without writing its text to the new session', () => {
        render('start');
        render('unsaved a');
        render('other', 'b');
        act(() => vi.advanceTimersByTime(2000));
        expect(state.writes).toEqual([['a', 'unsaved a']]);
    });
    it('clearing a sent draft cancels pending saves and prevents unmount resurrection', () => {
        render('start');
        render('sending');
        act(() => controls.clearDraft());
        act(() => vi.advanceTimersByTime(2000));
        act(() => { renderer.unmount(); renderer = undefined; });
        expect(state.sessions.a.draft).toBeNull();
        expect(state.writes).toEqual([['a', null]]);
    });
    it('saves empty/nonempty transitions immediately and accepts editing after clear', () => {
        state.sessions.a.draft = null;
        render('');
        render('new');
        expect(state.writes).toEqual([['a', 'new']]);
        act(() => controls.clearDraft());
        render('');
        render('next');
        expect(state.sessions.a.draft).toBe('next');
    });

    it('hydrates a saved draft without overwriting it with the initial empty render', () => {
        render('');
        expect(onChange).toHaveBeenCalledWith('start');
        render('start');
        act(() => vi.advanceTimersByTime(2000));
        expect(state.writes).toEqual([]);
    });
});
