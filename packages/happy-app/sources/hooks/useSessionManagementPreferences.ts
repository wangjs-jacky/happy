import * as React from 'react';
import {
    loadSessionManagementPreferences,
    saveSessionManagementPreferences,
    type SessionManagementPreferences,
} from '@/sync/persistence';

export type SessionManagementQueue = 'pinned' | 'focus';

function sameArray(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((item, index) => item === b[index]);
}

function unique(items: string[]): string[] {
    return Array.from(new Set(items));
}

let currentPreferences = loadSessionManagementPreferences();
const listeners = new Set<() => void>();

function emitPreferencesChanged() {
    listeners.forEach((listener) => listener());
}

function subscribePreferences(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getSessionManagementPreferencesSnapshot(): SessionManagementPreferences {
    return currentPreferences;
}

function updateSessionManagementPreferences(updater: (current: SessionManagementPreferences) => SessionManagementPreferences) {
    const next = updater(currentPreferences);
    if (next === currentPreferences) {
        return;
    }
    currentPreferences = next;
    saveSessionManagementPreferences(next);
    emitPreferencesChanged();
}

/**
 * Keeps the local session-management queues in sync with sessions that still
 * exist. The queue is intentionally local-only: pinning and focus ordering are
 * personal triage state, separate from encrypted session metadata.
 */
export function useSessionManagementPreferences(
    validSessionIds: string[],
    options: { prune?: boolean } = {},
) {
    const prune = options.prune ?? true;
    const validSessionIdSet = React.useMemo(() => new Set(validSessionIds), [validSessionIds]);
    const preferences = React.useSyncExternalStore(
        subscribePreferences,
        getSessionManagementPreferencesSnapshot,
        getSessionManagementPreferencesSnapshot,
    );

    const setPreferences = React.useCallback((updater: (current: SessionManagementPreferences) => SessionManagementPreferences) => {
        updateSessionManagementPreferences(updater);
    }, []);

    React.useEffect(() => {
        if (!prune) {
            return;
        }

        setPreferences((current) => {
            const pinnedOrder = unique(current.pinnedOrder).filter((id) => validSessionIdSet.has(id));
            const pinnedSet = new Set(pinnedOrder);
            const focusOrder = unique(current.focusOrder).filter((id) => validSessionIdSet.has(id) && !pinnedSet.has(id));

            if (sameArray(pinnedOrder, current.pinnedOrder) && sameArray(focusOrder, current.focusOrder)) {
                return current;
            }

            return { pinnedOrder, focusOrder };
        });
    }, [prune, setPreferences, validSessionIdSet]);

    const isPinned = React.useCallback((sessionId: string) => (
        preferences.pinnedOrder.includes(sessionId)
    ), [preferences.pinnedOrder]);

    const isFocused = React.useCallback((sessionId: string) => (
        preferences.focusOrder.includes(sessionId)
    ), [preferences.focusOrder]);

    const moveToPinned = React.useCallback((sessionId: string) => {
        setPreferences((current) => ({
            pinnedOrder: [sessionId, ...current.pinnedOrder.filter((id) => id !== sessionId)],
            focusOrder: current.focusOrder.filter((id) => id !== sessionId),
        }));
    }, [setPreferences]);

    const moveToFocus = React.useCallback((sessionId: string) => {
        setPreferences((current) => ({
            pinnedOrder: current.pinnedOrder.filter((id) => id !== sessionId),
            focusOrder: [sessionId, ...current.focusOrder.filter((id) => id !== sessionId)],
        }));
    }, [setPreferences]);

    const togglePinned = React.useCallback((sessionId: string) => {
        setPreferences((current) => {
            const pinned = current.pinnedOrder.includes(sessionId);
            return {
                pinnedOrder: pinned
                    ? current.pinnedOrder.filter((id) => id !== sessionId)
                    : [sessionId, ...current.pinnedOrder],
                focusOrder: current.focusOrder.filter((id) => id !== sessionId),
            };
        });
    }, [setPreferences]);

    const toggleFocus = React.useCallback((sessionId: string) => {
        setPreferences((current) => {
            const focused = current.focusOrder.includes(sessionId);
            return {
                pinnedOrder: focused ? current.pinnedOrder : current.pinnedOrder.filter((id) => id !== sessionId),
                focusOrder: focused
                    ? current.focusOrder.filter((id) => id !== sessionId)
                    : [sessionId, ...current.focusOrder.filter((id) => id !== sessionId)],
            };
        });
    }, [setPreferences]);

    const moveWithinQueueByOffset = React.useCallback((queue: SessionManagementQueue, sessionId: string, offset: number) => {
        setPreferences((current) => {
            const key = queue === 'pinned' ? 'pinnedOrder' : 'focusOrder';
            const order = current[key].slice();
            const index = order.indexOf(sessionId);
            if (index === -1) {
                return current;
            }

            const nextIndex = Math.max(0, Math.min(order.length - 1, index + offset));
            if (nextIndex === index) {
                return current;
            }

            order.splice(index, 1);
            order.splice(nextIndex, 0, sessionId);
            return { ...current, [key]: order };
        });
    }, [setPreferences]);

    const moveWithinQueue = React.useCallback((queue: SessionManagementQueue, sessionId: string, direction: 'up' | 'down') => {
        moveWithinQueueByOffset(queue, sessionId, direction === 'up' ? -1 : 1);
    }, [moveWithinQueueByOffset]);

    const moveToQueueTop = React.useCallback((queue: SessionManagementQueue, sessionId: string) => {
        if (queue === 'pinned') {
            moveToPinned(sessionId);
        } else {
            moveToFocus(sessionId);
        }
    }, [moveToFocus, moveToPinned]);

    return {
        preferences,
        isPinned,
        isFocused,
        moveToPinned,
        moveToFocus,
        togglePinned,
        toggleFocus,
        moveWithinQueue,
        moveWithinQueueByOffset,
        moveToQueueTop,
    };
}
