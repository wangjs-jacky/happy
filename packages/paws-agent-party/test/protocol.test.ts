import { describe, expect, it } from 'vitest';
import type { Message } from '@wangjs-jacky/paws-agent';
import { DurableTurnDecoder } from '../src/server/protocol.js';
import { initialTimeline, ownSend, receivedBatch } from '../src/timeline.js';
import type { TimelineMessage } from '../src/timeline.js';

const message = (seq: number, content: unknown, localId: string | null = null): Message => ({
  id: `m-${seq}`,
  seq,
  content,
  localId,
  createdAt: seq,
  updatedAt: seq,
});

const partyMessage = (cursor: number, text: string): TimelineMessage => ({
  id: `party-${cursor}`,
  cursor: String(cursor),
  ts: cursor,
  from: cursor === 3 ? 'host' : 'trend30',
  to: '*',
  kind: 'message',
  text,
});

const sessionEvent = (turn: string, ev: Record<string, unknown>, subagent?: string): unknown => ({
  role: 'session',
  content: { type: 'session', data: { role: 'agent', turn, ...(subagent ? { subagent } : {}), ev } },
});

describe('DurableTurnDecoder', () => {
  it('only completes the root turn that starts after the submitted localId echo', () => {
    const decoder = new DurableTurnDecoder('request-local-id');

    expect(decoder.accept(message(1, sessionEvent('old', { t: 'turn-start' })))).toBeNull();
    expect(decoder.accept(message(2, sessionEvent('old', { t: 'turn-end', status: 'completed' })))).toBeNull();
    expect(decoder.accept(message(3, { role: 'user' }, 'request-local-id'))).toBeNull();
    expect(decoder.accept(message(4, sessionEvent('child', { t: 'turn-start' }, 'researcher')))).toBeNull();
    expect(decoder.accept(message(5, sessionEvent('root', { t: 'turn-start' })))).toBeNull();
    expect(decoder.accept(message(6, sessionEvent('other', { t: 'text', text: 'wrong completion' })))).toBeNull();
    expect(decoder.accept(message(7, sessionEvent('other', { t: 'turn-end', status: 'completed' })))).toBeNull();
    expect(decoder.accept(message(8, sessionEvent('root', { t: 'text', text: 'durable answer' })))).toBeNull();
    expect(decoder.accept(message(9, sessionEvent('root', { t: 'turn-end', status: 'completed' })))).toEqual({
      type: 'completed',
      text: 'durable answer',
    });
  });

  it('reports a failed root turn instead of completing it', () => {
    const decoder = new DurableTurnDecoder('request-local-id');
    decoder.accept(message(1, { role: 'user' }, 'request-local-id'));
    decoder.accept(message(2, sessionEvent('root', { t: 'turn-start' })));

    expect(decoder.accept(message(3, sessionEvent('root', { t: 'turn-end', status: 'failed' })))).toEqual({
      type: 'failed',
      status: 'failed',
    });
  });
});

describe('timeline reducer', () => {
  it('does not advance the receive cursor when an own send lands ahead of a received batch', () => {
    const c1 = partyMessage(1, 'C1');
    const c2 = partyMessage(2, 'C2');
    const c3 = partyMessage(3, 'C3');

    const afterC1 = receivedBatch(initialTimeline(), [c1]);
    const afterOwnC3 = ownSend(afterC1, c3);
    const afterC2 = receivedBatch(afterOwnC3, [c2]);

    expect(afterOwnC3.receiveCursor).toBe(1);
    expect(afterC2.receiveCursor).toBe(2);
    expect(afterC2.messages.map(item => item.cursor)).toEqual(['1', '2', '3']);
  });
});
