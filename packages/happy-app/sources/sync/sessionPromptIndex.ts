import type { NormalizedMessage } from './typesRaw';
import { getUserMessageDisplayText } from '@/components/messageDisplayText';

/** Stable wire identity, independent of transient reducer IDs and the reading window. */
export type SessionPrompt = {
    id: string;
    seq: number;
    text: string;
    createdAt: number;
    localId?: string | null;
    editedFromMessageId?: string;
};
export type SessionPromptPage = { prompts: SessionPrompt[]; beforeSeq: number; hasMore: boolean };
export type SessionPromptNavigation = {
    key: string;
    readPage: (beforeSeq: number | undefined, isCurrent: () => boolean) => Promise<SessionPromptPage>;
    loadTarget: (prompt: { id: string; seq: number }, isCurrent: () => boolean) => Promise<void>;
};

export function sessionPrompt(wire: { id: string; seq: number }, message: NormalizedMessage | null): SessionPrompt | null {
    if (!message || message.role !== 'user' || message.isSidechain) return null;
    const text = getUserMessageDisplayText(message.meta?.displayText || message.content.text).trim().replace(/\s+/g, ' ');
    if (!text) return null;
    return { id: wire.id, seq: wire.seq, text: text.slice(0, 500), createdAt: message.createdAt,
        localId: message.localId, editedFromMessageId: message.meta?.editedFromMessageId };
}

export function mergeSessionPrompts(previous: SessionPrompt[], incoming: SessionPrompt[]): SessionPrompt[] {
    const records = new Map(previous.map(prompt => [prompt.id, prompt]));
    for (const prompt of incoming) records.set(prompt.id, prompt);
    return [...records.values()].sort((a, b) => a.seq - b.seq);
}

/** Retain edit tombstones in the index even when their own row is superseded. */
export function visibleSessionPrompts(records: SessionPrompt[]): SessionPrompt[] {
    const edited = new Set(records.flatMap(prompt => prompt.editedFromMessageId ? [prompt.editedFromMessageId] : []));
    return records.filter(prompt => !edited.has(prompt.id) && !(prompt.localId && edited.has(prompt.localId)));
}
