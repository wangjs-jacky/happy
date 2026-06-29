import { describe, it, expect } from 'vitest';
import { extractUserMessageAnchors } from './useUserMessageAnchors';
import type { DisplayItem } from './useGroupedMessages';
import type { Message } from '@/sync/typesMessage';

// Helpers to build DisplayItems. The chat list is inverted, so `displayItems`
// is newest-first — index 0 is the most recent item.
function userItem(id: string, text: string, createdAt: number, displayText?: string): DisplayItem {
    const message: Message = {
        kind: 'user-text',
        id,
        localId: null,
        createdAt,
        text,
        ...(displayText !== undefined ? { displayText } : {}),
    };
    return { type: 'message', id, message };
}

function agentItem(id: string, text: string, createdAt: number): DisplayItem {
    const message: Message = { kind: 'agent-text', id, localId: null, createdAt, text };
    return { type: 'message', id, message };
}

function toolGroupItem(id: string): DisplayItem {
    return { type: 'tool-group', id, messages: [], hasRunning: false, hasPendingPermission: false };
}

describe('extractUserMessageAnchors', () => {
    it('returns empty for an empty list', () => {
        expect(extractUserMessageAnchors([])).toEqual([]);
    });

    it('returns empty when there are no user messages', () => {
        const items = [agentItem('a1', 'hi', 100), toolGroupItem('g1')];
        expect(extractUserMessageAnchors(items)).toEqual([]);
    });

    it('extracts user messages oldest-first with chronological ordinals', () => {
        // newest-first input: u3 (newest) ... u1 (oldest)
        const items: DisplayItem[] = [
            agentItem('a3', 'answer 3', 300),
            userItem('u3', 'third question', 290),
            agentItem('a2', 'answer 2', 200),
            userItem('u2', 'second question', 190),
            userItem('u1', 'first question', 100),
        ];
        const anchors = extractUserMessageAnchors(items);
        expect(anchors.map((a) => a.id)).toEqual(['u1', 'u2', 'u3']);
        expect(anchors.map((a) => a.ordinal)).toEqual([1, 2, 3]);
        // displayIndex must point back into the original newest-first array
        expect(anchors.find((a) => a.id === 'u1')!.displayIndex).toBe(4);
        expect(anchors.find((a) => a.id === 'u2')!.displayIndex).toBe(3);
        expect(anchors.find((a) => a.id === 'u3')!.displayIndex).toBe(1);
    });

    it('prefers displayText over raw text and collapses whitespace', () => {
        const items = [userItem('u1', 'raw text', 100, '  shown   text\n\nhere ')];
        const [anchor] = extractUserMessageAnchors(items);
        expect(anchor.text).toBe('shown text here');
    });

    it('skips user messages whose preview text is empty', () => {
        const items = [userItem('u1', '   ', 100), userItem('u2', 'real', 200)];
        const anchors = extractUserMessageAnchors(items);
        expect(anchors.map((a) => a.id)).toEqual(['u2']);
        expect(anchors[0].ordinal).toBe(1);
    });

    it('carries createdAt through', () => {
        const items = [userItem('u1', 'q', 1234)];
        expect(extractUserMessageAnchors(items)[0].createdAt).toBe(1234);
    });
});
