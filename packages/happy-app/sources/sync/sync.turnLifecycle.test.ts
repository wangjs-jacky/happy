import { describe, expect, it, vi } from 'vitest';
import { createReducer, reducer } from './reducer/reducer';
import { notifyReadyEvent } from './syncMessageEffects';
import type { NormalizedMessage } from './typesRaw';

const terminal = (id: string, seq: number): NormalizedMessage => ({
    id,
    localId: null,
    createdAt: seq,
    role: 'event',
    content: { type: 'turn-lifecycle', status: 'completed', seq },
    isSidechain: false,
});

describe('sync lifecycle ready callback', () => {
    it('notifies once for an accepted terminal and not for stale replay', () => {
        const state = createReducer();
        const onReady = vi.fn();

        notifyReadyEvent('session-1', reducer(state, [terminal('current', 2)]).hasReadyEvent, onReady);
        notifyReadyEvent('session-1', reducer(state, [terminal('stale', 1)]).hasReadyEvent, onReady);

        expect(onReady).toHaveBeenCalledTimes(1);
        expect(onReady).toHaveBeenCalledWith('session-1');
    });
});
