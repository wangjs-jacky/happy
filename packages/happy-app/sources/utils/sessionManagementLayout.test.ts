import { describe, expect, it } from 'vitest';
import {
    buildSessionManagementSections,
    getSessionManagementPrimaryStatus,
    type SessionManagementSortItem,
} from './sessionManagementLayout';

function item(overrides: Partial<SessionManagementSortItem> & { id: string }): SessionManagementSortItem {
    return {
        id: overrides.id,
        pinned: overrides.pinned ?? false,
        needsAction: overrides.needsAction ?? false,
        running: overrides.running ?? false,
        primaryStatus: overrides.primaryStatus ?? 'recent',
        updatedAt: overrides.updatedAt ?? 0,
    };
}

function ids(items: SessionManagementSortItem[]): string[] {
    return items.map((entry) => entry.id);
}

describe('session management layout', () => {
    it('keeps pinned and needs-action active sessions in their manual queues', () => {
        const sections = buildSessionManagementSections({
            items: [
                item({ id: 'recent-active', updatedAt: 30 }),
                item({ id: 'pinned-active', pinned: true, running: true, primaryStatus: 'running', updatedAt: 20 }),
                item({ id: 'needs-active', needsAction: true, running: true, primaryStatus: 'unread', updatedAt: 10 }),
            ],
            activeSessionOrder: ['pinned-active', 'needs-active', 'recent-active'],
            pinnedOrder: ['pinned-active'],
            focusOrder: ['needs-active'],
            showActiveGroup: true,
        });

        expect(ids(sections.pinned)).toEqual(['pinned-active']);
        expect(ids(sections.needs)).toEqual(['needs-active']);
        expect(ids(sections.active)).toEqual(['recent-active']);
        expect(ids(sections.running)).toEqual([]);
    });

    it('uses manual queue order before priority fallback', () => {
        const sections = buildSessionManagementSections({
            items: [
                item({ id: 'newer', pinned: true, primaryStatus: 'permission', updatedAt: 300 }),
                item({ id: 'older', pinned: true, primaryStatus: 'recent', updatedAt: 100 }),
                item({ id: 'fallback', pinned: true, primaryStatus: 'unread', updatedAt: 200 }),
            ],
            activeSessionOrder: [],
            pinnedOrder: ['older', 'newer'],
            focusOrder: [],
            showActiveGroup: true,
        });

        expect(ids(sections.pinned)).toEqual(['older', 'newer', 'fallback']);
    });

    it('keeps action reasons above running status', () => {
        expect(getSessionManagementPrimaryStatus({
            hasPermission: false,
            running: true,
            unread: true,
            hasDraft: false,
            incompleteTodosCount: 0,
            manualFocus: false,
        })).toBe('unread');

        expect(getSessionManagementPrimaryStatus({
            hasPermission: false,
            running: true,
            unread: false,
            hasDraft: true,
            incompleteTodosCount: 0,
            manualFocus: false,
        })).toBe('draft');

        expect(getSessionManagementPrimaryStatus({
            hasPermission: false,
            running: true,
            unread: false,
            hasDraft: false,
            incompleteTodosCount: 0,
            manualFocus: false,
        })).toBe('running');
    });
});
