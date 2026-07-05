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

import { getAllCommands, searchCommands } from './suggestionCommands';
import { storage } from './storage';

afterEach(() => {
    mockState.sessions = {};
});

describe('suggestionCommands', () => {
    it('merges default commands and slash commands', () => {
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
                        slashCommands: ['compact', 'debug'],
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

        expect(getAllCommands('session-1')).toEqual([
            { command: 'compact', description: 'Compact the conversation history' },
            { command: 'clear', description: 'Clear the conversation' },
            { command: 'mcp', description: 'Show connected MCP servers' },
            { command: 'skills', description: 'Show available skills' },
            { command: 'debug', description: 'Show debug information' },
        ]);
    });

    it('dedupes repeated command names across slash commands and defaults', () => {
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
                        slashCommands: ['skills', 'clear', 'brainstorming'],
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
        expect(getAllCommands('session-2').filter((entry) => entry.command === 'skills')).toHaveLength(1);
        expect(getAllCommands('session-2').filter((entry) => entry.command === 'clear')).toHaveLength(1);
    });

    it('searches discovered slash commands by name', async () => {
        storage.setState({
            sessions: {
                'session-3': {
                    id: 'session-3',
                    seq: 1,
                    createdAt: 0,
                    updatedAt: 0,
                    active: true,
                    activeAt: 0,
                    metadata: {
                        path: '/tmp',
                        host: 'localhost',
                        slashCommands: ['using-superpowers'],
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

        const results = await searchCommands('session-3', 'super');
        expect(results.map((entry) => entry.command)).toContain('using-superpowers');
    });

    it('describes the Codex goal slash command when advertised by session metadata', async () => {
        storage.setState({
            sessions: {
                'session-4': {
                    id: 'session-4',
                    seq: 1,
                    createdAt: 0,
                    updatedAt: 0,
                    active: true,
                    activeAt: 0,
                    metadata: {
                        path: '/tmp',
                        host: 'localhost',
                        slashCommands: ['goal'],
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

        await expect(searchCommands('session-4', 'goal')).resolves.toEqual([
            { command: 'goal', description: 'Manage the Codex thread goal' },
        ]);
    });

    it('adds the Codex mobile slash commands for existing Codex sessions without slash metadata', async () => {
        storage.setState({
            sessions: {
                'session-5': {
                    id: 'session-5',
                    seq: 1,
                    createdAt: 0,
                    updatedAt: 0,
                    active: true,
                    activeAt: 0,
                    metadata: {
                        path: '/tmp',
                        host: 'localhost',
                        flavor: 'codex',
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

        const commands = getAllCommands('session-5').map((entry) => entry.command);
        expect(commands).toEqual([
            'compact',
            'clear',
            'mcp',
            'skills',
            'goal',
            'usage',
            'status',
            'diff',
            'new',
            'fork',
            'review',
            'plan',
        ]);
    });

    it('keeps TUI-only Codex slash commands out of mobile autocomplete', () => {
        storage.setState({
            sessions: {
                'session-6': {
                    id: 'session-6',
                    seq: 1,
                    createdAt: 0,
                    updatedAt: 0,
                    active: true,
                    activeAt: 0,
                    metadata: {
                        path: '/tmp',
                        host: 'localhost',
                        flavor: 'codex',
                        slashCommands: ['vim', 'keymap', 'theme', 'title', 'goal', 'usage'],
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

        const commands = getAllCommands('session-6').map((entry) => entry.command);
        expect(commands).not.toContain('vim');
        expect(commands).not.toContain('keymap');
        expect(commands).not.toContain('theme');
        expect(commands).not.toContain('title');
        expect(commands).toContain('goal');
        expect(commands).toContain('usage');
    });
});
