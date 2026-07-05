export interface SessionApplyOptions {
    replace?: boolean;
}

export function createSessionApplyBase<T>(
    existingSessions: Record<string, T>,
    incomingSessionIds: Set<string>,
    options?: SessionApplyOptions,
): { sessions: Record<string, T>; removedIds: string[] } {
    if (!options?.replace) {
        return {
            sessions: { ...existingSessions },
            removedIds: [],
        };
    }

    return {
        sessions: {},
        removedIds: Object.keys(existingSessions).filter((sessionId) => !incomingSessionIds.has(sessionId)),
    };
}
