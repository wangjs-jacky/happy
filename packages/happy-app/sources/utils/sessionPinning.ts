export function sortSessionsForList<T extends { id: string; createdAt?: number }>(
    sessions: T[],
    pinnedOrder: string[],
): T[] {
    const orderById = new Map(pinnedOrder.map((id, index) => [id, index]));

    return sessions.slice().sort((a, b) => {
        const aPinnedIndex = orderById.get(a.id);
        const bPinnedIndex = orderById.get(b.id);

        if (aPinnedIndex != null && bPinnedIndex != null) {
            return aPinnedIndex - bPinnedIndex;
        }
        if (aPinnedIndex != null) {
            return -1;
        }
        if (bPinnedIndex != null) {
            return 1;
        }

        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
}
