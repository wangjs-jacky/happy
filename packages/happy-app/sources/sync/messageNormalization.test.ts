import { describe, expect, it } from 'vitest';
import { normalizeDecryptedMessage, normalizeDecryptedMessages, normalizeRealtimeDecryptedMessage } from './messageNormalization';
import type { DecryptedMessage } from './storageTypes';
import { createReducer, reducer } from './reducer/reducer';

const turnStart = (id: string): DecryptedMessage => ({
    id,
    seq: null,
    localId: null,
    createdAt: 100,
    content: {
        role: 'agent' as const,
        content: {
            type: 'session' as const,
            data: { id, time: 100, role: 'agent' as const, turn: 'turn-1', ev: { t: 'turn-start' as const } },
        },
    },
});

describe('message normalization source sequence', () => {
    it('forwards the matching API sequence while preserving null alignment', () => {
        const normalized = normalizeDecryptedMessages(
            [{ seq: 11 }, { seq: 12 }],
            [null, turnStart('start')],
        );
        expect(normalized).toHaveLength(1);
        expect(normalized[0]).toMatchObject({ content: { type: 'turn-lifecycle', seq: 12 } });
    });

    it('forwards the realtime source message sequence', () => {
        expect(normalizeDecryptedMessage(turnStart('realtime'), { seq: 88 })).toMatchObject({
            content: { type: 'turn-lifecycle', seq: 88 },
        });
    });

    it('keeps realtime and fetched lifecycle in the per-message sequence domain', () => {
        const realtimeUpdate = { seq: 1000, body: { message: { seq: 10 } } };
        const realtime = normalizeRealtimeDecryptedMessage(turnStart('realtime-start'), realtimeUpdate);
        const fetchedEnd: DecryptedMessage = {
            ...turnStart('fetched-end'),
            content: {
                role: 'agent',
                content: {
                    type: 'session',
                    data: {
                        id: 'fetched-end', time: 101, role: 'agent', turn: 'turn-1',
                        ev: { t: 'turn-end', status: 'completed' },
                    },
                },
            },
        };
        const [fetched] = normalizeDecryptedMessages([{ seq: 11 }], [fetchedEnd]);
        const state = createReducer();

        reducer(state, [realtime!, fetched]);

        expect(state.rootTurnLifecycle).toMatchObject({ status: 'completed', seq: 11 });
    });
});
