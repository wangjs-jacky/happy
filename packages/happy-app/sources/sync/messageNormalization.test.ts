import { describe, expect, it } from 'vitest';
import { normalizeDecryptedMessage, normalizeDecryptedMessages } from './messageNormalization';
import type { DecryptedMessage } from './storageTypes';

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

    it('forwards realtime update sequence', () => {
        expect(normalizeDecryptedMessage(turnStart('realtime'), 88)).toMatchObject({
            content: { type: 'turn-lifecycle', seq: 88 },
        });
    });
});
