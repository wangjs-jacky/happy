import { describe, expect, it } from 'vitest';
import { SessionHistoryScrollIntent } from './sessionHistoryScrollIntent';

describe('SessionHistoryScrollIntent', () => {
    it('does not authorize the initial end callback or an unchanged zero Web offset', () => {
        const intent = new SessionHistoryScrollIntent();

        expect(intent.consumeAtEnd()).toBe(false);
        intent.noteWebScroll(0);
        expect(intent.consumeAtEnd()).toBe(false);
    });

    it('consumes each changed Web scroll offset exactly once', () => {
        const intent = new SessionHistoryScrollIntent();

        intent.noteWebScroll(120);
        expect(intent.consumeAtEnd()).toBe(true);
        expect(intent.consumeAtEnd()).toBe(false);

        intent.noteWebScroll(120);
        expect(intent.consumeAtEnd()).toBe(false);

        intent.noteWebScroll(240);
        expect(intent.consumeAtEnd()).toBe(true);
        expect(intent.consumeAtEnd()).toBe(false);
    });

    it('consumes each native drag exactly once', () => {
        const intent = new SessionHistoryScrollIntent();

        intent.noteNativeDrag();
        expect(intent.consumeAtEnd()).toBe(true);
        expect(intent.consumeAtEnd()).toBe(false);

        intent.noteNativeDrag();
        expect(intent.consumeAtEnd()).toBe(true);
    });
});
