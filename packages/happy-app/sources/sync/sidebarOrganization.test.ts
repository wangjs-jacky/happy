import { describe, expect, it } from 'vitest';
import {
    normalizeSidebarOrganization,
    organizeSession,
    removeSidebarList,
    removeSidebarTag,
    type SidebarOrganization,
} from './sidebarOrganization';

const organization: SidebarOrganization = {
    lists: [
        { id: 'workspace', name: 'Happy', kind: 'workspace', color: 'blue', machineId: 'mac', path: '~/happy', defaultAgent: 'codex', createdAt: 1 },
        { id: 'advisor', name: 'Advisor', kind: 'agent', color: 'pink', prompt: 'Help me think', createdAt: 2 },
    ],
    tags: [
        { id: 'product', name: 'product', color: 'green', createdAt: 1 },
        { id: 'research', name: 'research', color: 'purple', createdAt: 2 },
    ],
    sessions: {},
};

describe('sidebar organization model', () => {
    it('keeps one list and multiple unique tags per session', () => {
        const next = organizeSession(organization, 'session-1', {
            listId: 'workspace',
            tagIds: ['product', 'research', 'product'],
        });

        expect(next.sessions['session-1']).toEqual({
            listId: 'workspace',
            tagIds: ['product', 'research'],
        });
    });

    it('clears deleted list and tag references without removing the session', () => {
        const assigned = organizeSession(organization, 'session-1', {
            listId: 'workspace',
            tagIds: ['product', 'research'],
        });

        expect(removeSidebarTag(removeSidebarList(assigned, 'workspace'), 'product').sessions['session-1']).toEqual({
            listId: null,
            tagIds: ['research'],
        });
    });

    it('drops references to records that do not exist', () => {
        expect(normalizeSidebarOrganization({
            ...organization,
            sessions: { broken: { listId: 'missing', tagIds: ['missing'] } },
        }).sessions.broken).toEqual({ listId: null, tagIds: [] });
    });
});
