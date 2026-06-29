import * as React from 'react';
import type { DisplayItem } from './useGroupedMessages';

/**
 * A jump target in the chat: one message the user sent. The chat's natural
 * "chapters" are the user's own prompts, so we turn each into an anchor the
 * user can jump back to from a table-of-contents sheet.
 */
export interface UserMessageAnchor {
    /** Message id (stable key). */
    id: string;
    /**
     * Index into the inverted `displayItems` array (newest-first). Feed this
     * straight into `FlatList.scrollToIndex` to jump to the message.
     */
    displayIndex: number;
    /** One-line preview (displayText preferred, whitespace collapsed). */
    text: string;
    createdAt: number;
    /** 1-based chronological order (1 = first thing the user said). */
    ordinal: number;
}

/**
 * Pull the user's messages out of the grouped display list.
 *
 * `displayItems` is newest-first (the chat FlatList is inverted), so we walk
 * it as-is to capture each item's real `displayIndex`, then reverse the
 * result to hand callers an oldest-first list with ascending ordinals — the
 * order a reader expects in a table of contents. Messages with no visible
 * text (e.g. attachment-only turns) are skipped.
 */
export function extractUserMessageAnchors(items: DisplayItem[]): UserMessageAnchor[] {
    const found: UserMessageAnchor[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type !== 'message' || item.message.kind !== 'user-text') {
            continue;
        }
        const message = item.message;
        const preview = (message.displayText ?? message.text ?? '').trim().replace(/\s+/g, ' ');
        if (preview.length === 0) {
            continue;
        }
        found.push({
            id: item.id,
            displayIndex: i,
            text: preview,
            createdAt: message.createdAt,
            ordinal: 0, // filled in below once we know the total
        });
    }

    // `found` is newest-first; ordinal 1 belongs to the oldest message.
    const total = found.length;
    found.forEach((anchor, k) => {
        anchor.ordinal = total - k;
    });
    return found.reverse();
}

export function useUserMessageAnchors(items: DisplayItem[]): UserMessageAnchor[] {
    return React.useMemo(() => extractUserMessageAnchors(items), [items]);
}
