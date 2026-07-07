import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { collectGeneratedImagesFromMessages, type GeneratedImageEntry } from '@/hooks/generatedImagesModel';
import { sync } from '@/sync/sync';
import { storage } from '@/sync/storage';
export type { GeneratedImageEntry } from '@/hooks/generatedImagesModel';

function sessionTitle(session: { metadata?: { title?: string | null; path?: string | null } | null; id: string } | undefined): string {
    const title = session?.metadata?.title;
    if (title && title.trim()) return title;
    const path = session?.metadata?.path;
    if (path && path.trim()) return path.split('/').filter(Boolean).pop() || path;
    return session?.id ?? '';
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
            entries.push(...collectGeneratedImagesFromMessages(
                sessionId,
                sessionTitle(snapshot.sessions[sessionId]),
                data.messages,
            ));
        }
        return entries.sort((a, b) => b.createdAt - a.createdAt);
    }, [snapshot]);
}
