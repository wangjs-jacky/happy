import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { sync } from '@/sync/sync';
import { storage } from '@/sync/storage';
import type { Message } from '@/sync/typesMessage';

export type GeneratedImageEntry = {
    id: string;
    sessionId: string;
    sessionTitle: string;
    messageId: string;
    ref: string;
    name: string;
    createdAt: number;
    prompt?: string;
    batchId?: string;
    localPath?: string;
    width?: number;
    height?: number;
    thumbhash?: string;
};

type FileImageInput = {
    ref: string;
    name?: string;
    source?: 'user' | 'generated';
    prompt?: string;
    batchId?: string;
    localPath?: string;
    image?: {
        width?: number;
        height?: number;
        thumbhash?: string;
    };
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseGeneratedImageInput(input: unknown): FileImageInput | null {
    if (!isRecord(input)) return null;
    if (input.source !== 'generated') return null;
    const ref = typeof input.ref === 'string' ? input.ref : null;
    if (!ref) return null;
    const image = isRecord(input.image) ? input.image : undefined;
    return {
        ref,
        name: typeof input.name === 'string' ? input.name : undefined,
        source: 'generated',
        prompt: typeof input.prompt === 'string' ? input.prompt : undefined,
        batchId: typeof input.batchId === 'string' ? input.batchId : undefined,
        localPath: typeof input.localPath === 'string' ? input.localPath : undefined,
        image: image ? {
            width: typeof image.width === 'number' ? image.width : undefined,
            height: typeof image.height === 'number' ? image.height : undefined,
            thumbhash: typeof image.thumbhash === 'string' ? image.thumbhash : undefined,
        } : undefined,
    };
}

function sessionTitle(session: { metadata?: { title?: string | null; path?: string | null } | null; id: string } | undefined): string {
    const title = session?.metadata?.title;
    if (title && title.trim()) return title;
    const path = session?.metadata?.path;
    if (path && path.trim()) return path.split('/').filter(Boolean).pop() || path;
    return session?.id ?? '';
}

function collectFromMessages(sessionId: string, title: string, messages: Message[]): GeneratedImageEntry[] {
    const entries: GeneratedImageEntry[] = [];
    for (const message of messages) {
        if (message.kind !== 'tool-call' || message.tool.name !== 'file') continue;
        const parsed = parseGeneratedImageInput(message.tool.input);
        if (!parsed) continue;
        entries.push({
            id: `${sessionId}:${message.id}`,
            sessionId,
            sessionTitle: title,
            messageId: message.id,
            ref: parsed.ref,
            name: parsed.name || 'image.png',
            createdAt: message.createdAt,
            ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
            ...(parsed.batchId ? { batchId: parsed.batchId } : {}),
            ...(parsed.localPath ? { localPath: parsed.localPath } : {}),
            ...(parsed.image?.width !== undefined ? { width: parsed.image.width } : {}),
            ...(parsed.image?.height !== undefined ? { height: parsed.image.height } : {}),
            ...(parsed.image?.thumbhash !== undefined ? { thumbhash: parsed.image.thumbhash } : {}),
        });
    }
    return entries;
}

export function useGeneratedImages(): GeneratedImageEntry[] {
    const snapshot = storage(useShallow((state) => ({
        sessions: state.sessions,
        sessionMessages: state.sessionMessages,
        isDataReady: state.isDataReady,
    })));
    const requestedSessionIds = React.useRef(new Set<string>());

    React.useEffect(() => {
        if (!snapshot.isDataReady) return;
        const unloadedSessionIds = Object.keys(snapshot.sessions)
            .filter((sessionId) => !snapshot.sessionMessages[sessionId]?.isLoaded)
            .filter((sessionId) => !requestedSessionIds.current.has(sessionId));
        if (unloadedSessionIds.length === 0) return;

        let cancelled = false;
        let nextIndex = 0;
        const loadNext = async (): Promise<void> => {
            if (cancelled) return;
            const sessionId = unloadedSessionIds[nextIndex++];
            if (!sessionId) return;
            requestedSessionIds.current.add(sessionId);
            try {
                await sync.ensureMessagesLoaded(sessionId);
            } catch {
                requestedSessionIds.current.delete(sessionId);
            }
            await loadNext();
        };

        void loadNext();
        void loadNext();

        return () => {
            cancelled = true;
        };
    }, [snapshot.isDataReady, snapshot.sessionMessages, snapshot.sessions]);

    return React.useMemo(() => {
        if (!snapshot.isDataReady) return [];
        const entries: GeneratedImageEntry[] = [];
        for (const [sessionId, data] of Object.entries(snapshot.sessionMessages)) {
            entries.push(...collectFromMessages(
                sessionId,
                sessionTitle(snapshot.sessions[sessionId]),
                data.messages,
            ));
        }
        return entries.sort((a, b) => b.createdAt - a.createdAt);
    }, [snapshot]);
}
