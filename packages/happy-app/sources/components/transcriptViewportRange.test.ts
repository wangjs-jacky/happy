import { expect, it } from 'vitest';
import type { Message } from '@/sync/typesMessage';
import { transcriptViewportRange } from './transcriptViewportRange';
const message = (seq: number, kind = 'agent-text') => ({ id: String(seq), kind, text: String(seq) } as Message);
const seq = (id: string) => Number(id);

it('keeps the prompt and final response of a visible work group when paging trims either end', () => {
    const messages = [message(10), message(9, 'user-text'), message(8), message(7), message(6),
        message(5), message(4), message(3), message(2, 'user-text'), message(1)];
    expect(transcriptViewportRange(messages, [messages[5], messages[6]], seq)).toEqual({ firstSeq: 2, lastSeq: 8 });
});
it('protects each visible turn without retaining unrelated turns', () => {
    const messages = [message(9), message(8, 'user-text'), message(7), message(6, 'user-text'),
        message(5), message(4, 'user-text'), message(3), message(2, 'user-text'), message(1)];
    expect(transcriptViewportRange(messages, [messages[2], messages[4]], seq)).toEqual({ firstSeq: 4, lastSeq: 7 });
});
it('protects a loaded partial turn and ignores messages without wire provenance', () => {
    const messages = [message(7), message(6), message(5)];
    expect(transcriptViewportRange(messages, [messages[1]], seq)).toEqual({ firstSeq: 5, lastSeq: 7 });
    expect(transcriptViewportRange(messages, [message(0)], () => null)).toBeUndefined();
});

it('includes unrendered raw events through the next prompt and loaded window edges', () => {
    const messages = [message(18), message(12, 'user-text'), message(8), message(4, 'user-text'), message(2)];
    expect(transcriptViewportRange(messages, [messages[0]], seq, { oldestSeq: 1, newestSeq: 20 }))
        .toEqual({ firstSeq: 12, lastSeq: 20 });
    expect(transcriptViewportRange(messages, [messages[2]], seq, { oldestSeq: 1, newestSeq: 20 }))
        .toEqual({ firstSeq: 4, lastSeq: 11 });
    expect(transcriptViewportRange(messages, [messages[4]], seq, { oldestSeq: 1, newestSeq: 20 }))
        .toEqual({ firstSeq: 1, lastSeq: 3 });
});
