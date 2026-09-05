export type MessageRange = Readonly<{ minSeq: number; maxSeq: number }>;
export type MessageRangeFrontier = Readonly<{
    latestSeq: number | null;
    olderBeforeSeq: number | null;
    hasMoreOlder: boolean;
}>;

export function applyLatestRange(
    current: MessageRangeFrontier | undefined,
    page: MessageRange | null,
    hasMore: boolean,
): MessageRangeFrontier {
    if (!page) return current ?? { latestSeq: 0, olderBeforeSeq: null, hasMoreOlder: false };
    if (current?.latestSeq != null && current.latestSeq > page.maxSeq) return current;
    const connects = current?.latestSeq != null && current.olderBeforeSeq != null
        && page.minSeq <= current.latestSeq + 1 && page.maxSeq >= current.olderBeforeSeq - 1;
    const keepsOlder = connects && current.olderBeforeSeq! <= page.minSeq;
    const olderBeforeSeq = keepsOlder ? current.olderBeforeSeq! : page.minSeq;
    return {
        latestSeq: Math.max(current?.latestSeq ?? 0, page.maxSeq),
        olderBeforeSeq,
        hasMoreOlder: olderBeforeSeq > 1 && (keepsOlder ? current.hasMoreOlder : hasMore),
    };
}

export function applyOlderRange(
    current: MessageRangeFrontier,
    page: MessageRange | null,
    hasMore: boolean,
    cachedSeqs: readonly number[],
): MessageRangeFrontier {
    // The page answers before_seq=current.olderBeforeSeq. That request has
    // observed the interval above the returned page even when allocated
    // sequence numbers have no message. Cached islands below it still need
    // actual adjacency before they can be joined.
    if (!page) return { ...current, hasMoreOlder: false };
    if (current.olderBeforeSeq == null || page.minSeq >= current.olderBeforeSeq) return current;
    let olderBeforeSeq = page.minSeq;
    const cached = new Set(cachedSeqs);
    // Only observed adjacent sequences can join an older cached island.
    while (olderBeforeSeq > 1 && cached.has(olderBeforeSeq - 1)) olderBeforeSeq--;
    return { ...current, olderBeforeSeq, hasMoreOlder: hasMore && olderBeforeSeq > 1 };
}
