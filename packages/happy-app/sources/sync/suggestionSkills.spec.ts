import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
    sessions: {} as Record<string, any>,
}));

vi.mock('./storage', () => ({
    storage: {
        getState: () => mockState,
        setState: (partial: Partial<typeof mockState>) => {
            Object.assign(mockState, partial);
        },
    },
}));

import { getAllSkills, searchSkills } from './suggestionSkills';
import { storage } from './storage';

afterEach(() => {
    mockState.sessions = {};
});

describe('suggestionSkills', () => {
    it('reads and dedupes skills from session metadata', () => {
        storage.setState({
            sessions: {
                'session-1': {
                    id: 'session-1',
                    seq: 1,
                    createdAt: 0,
                    updatedAt: 0,
                    active: true,
                    activeAt: 0,
                    metadata: {
                        path: '/tmp',
                        host: 'localhost',
                        skills: ['using-superpowers', 'brainstorming', 'brainstorming'],
                    },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 'online',
                },
            },
        } as any);

        expect(getAllSkills('session-1')).toEqual([
            { name: 'using-superpowers' },
            { name: 'brainstorming' },
        ]);
    });

    it('returns all skills for empty queries and strips prefix markers', async () => {
        storage.setState({
            sessions: {
                'session-2': {
                    id: 'session-2',
                    seq: 1,
                    createdAt: 0,
                    updatedAt: 0,
                    active: true,
                    activeAt: 0,
                    metadata: {
                        path: '/tmp',
                        host: 'localhost',
                        skills: ['using-superpowers', 'skill-creator'],
                    },
                    metadataVersion: 1,
                    agentState: null,
                    agentStateVersion: 0,
                    thinking: false,
                    thinkingAt: 0,
                    presence: 'online',
                },
            },
        } as any);

        expect(await searchSkills('session-2', '')).toEqual([
            { name: 'using-superpowers' },
            { name: 'skill-creator' },
        ]);
        expect((await searchSkills('session-2', '$creator')).map((entry) => entry.name)).toContain('skill-creator');
        expect((await searchSkills('session-2', '/super')).map((entry) => entry.name)).toContain('using-superpowers');
    });
});
