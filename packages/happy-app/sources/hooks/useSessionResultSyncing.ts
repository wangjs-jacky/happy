import { storage } from '@/sync/storage';

/**
 * Subscribe only the open conversation to the gap between its known latest
 * message sequence and the latest contiguous sequence committed to its list.
 * Older-history windows and caches without a verified baseline do not imply
 * pending results; loading old messages must not change completion feedback.
 */
export function useSessionResultSyncing(sessionId: string): boolean {
    return storage((state) => {
        const cache = state.sessionMessages[sessionId];
        const session = state.sessions[sessionId];
        return !!(session && cache?.isLoaded && cache.isAtLatest !== false
            && typeof cache.latestAppliedSeq === 'number'
            && session.seq > cache.latestAppliedSeq);
    });
}
