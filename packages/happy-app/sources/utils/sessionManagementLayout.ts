export type SessionManagementPrimaryStatus = 'permission' | 'running' | 'unread' | 'draft' | 'todo' | 'manual' | 'recent';

export interface SessionManagementSortItem {
    id: string;
    pinned: boolean;
    needsAction: boolean;
    running: boolean;
    primaryStatus: SessionManagementPrimaryStatus;
    updatedAt: number;
}

export interface SessionManagementStatusSignals {
    hasPermission: boolean;
    running: boolean;
    unread: boolean;
    hasDraft: boolean;
    incompleteTodosCount: number;
    manualFocus: boolean;
}

export interface SessionManagementSections<T extends SessionManagementSortItem> {
    active: T[];
    pinned: T[];
    needs: T[];
    running: T[];
    recent: T[];
}

export function getSessionManagementPrimaryStatus(signals: SessionManagementStatusSignals): SessionManagementPrimaryStatus {
    if (signals.hasPermission) return 'permission';
    if (signals.unread) return 'unread';
    if (signals.hasDraft) return 'draft';
    if (signals.incompleteTodosCount > 0) return 'todo';
    if (signals.manualFocus) return 'manual';
    if (signals.running) return 'running';
    return 'recent';
}

export function buildSessionManagementSections<T extends SessionManagementSortItem>({
    items,
    activeSessionOrder,
    pinnedOrder,
    focusOrder,
    showActiveGroup,
}: {
    items: T[];
    activeSessionOrder: string[];
    pinnedOrder: string[];
    focusOrder: string[];
    showActiveGroup: boolean;
}): SessionManagementSections<T> {
    const activeSessionIdSet = new Set(activeSessionOrder);
    const pinned = sortByQueue(
        items.filter((item) => item.pinned),
        pinnedOrder,
    );
    const needs = sortByQueue(
        items.filter((item) => !item.pinned && item.needsAction),
        focusOrder,
    );
    const manualQueueIds = new Set([...pinned, ...needs].map((item) => item.id));
    const active = showActiveGroup
        ? sortByQueue(
            items.filter((item) => !manualQueueIds.has(item.id) && activeSessionIdSet.has(item.id)),
            activeSessionOrder,
        )
        : [];
    const activeIds = new Set(active.map((item) => item.id));
    const running = sortByPriority(
        items.filter((item) => !manualQueueIds.has(item.id) && !activeIds.has(item.id) && item.running),
    );
    const recent = sortByPriority(
        items.filter((item) => !manualQueueIds.has(item.id) && !activeIds.has(item.id) && !item.running),
    );

    return { active, pinned, needs, running, recent };
}

export function sortByPriority<T extends SessionManagementSortItem>(items: T[]): T[] {
    const priority: Record<SessionManagementPrimaryStatus, number> = {
        permission: 0,
        unread: 1,
        draft: 2,
        todo: 3,
        manual: 4,
        running: 5,
        recent: 6,
    };
    return items.slice().sort((a, b) => (
        priority[a.primaryStatus] - priority[b.primaryStatus] || b.updatedAt - a.updatedAt
    ));
}

export function sortByQueue<T extends SessionManagementSortItem>(items: T[], order: string[]): T[] {
    const orderById = new Map(order.map((id, index) => [id, index]));
    return items.slice().sort((a, b) => {
        const aIndex = orderById.get(a.id);
        const bIndex = orderById.get(b.id);
        if (aIndex != null && bIndex != null) return aIndex - bIndex;
        if (aIndex != null) return -1;
        if (bIndex != null) return 1;
        return sortByPriority([a, b])[0].id === a.id ? -1 : 1;
    });
}
