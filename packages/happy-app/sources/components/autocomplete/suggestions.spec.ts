import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    searchCommands: vi.fn(),
    searchFiles: vi.fn(),
    searchSkills: vi.fn(),
}));

vi.mock('@/components/AgentInputSuggestionView', () => ({
    CommandSuggestion: () => null,
    FileMentionSuggestion: () => null,
    SkillSuggestion: () => null,
}));

vi.mock('@/sync/suggestionCommands', () => ({
    searchCommands: mocks.searchCommands,
}));

vi.mock('@/sync/suggestionFile', () => ({
    searchFiles: mocks.searchFiles,
}));

vi.mock('@/sync/suggestionSkills', () => ({
    searchSkills: mocks.searchSkills,
}));

import { getSuggestions } from './suggestions';

describe('autocomplete suggestions', () => {
    it('uses $ insertion for Codex slash skill suggestions and hides the /skills command row', async () => {
        mocks.searchCommands.mockResolvedValueOnce([
            { command: 'compact', description: 'Compact the conversation history' },
            { command: 'skills', description: 'Show available skills' },
        ]);
        mocks.searchSkills.mockResolvedValueOnce([
            { name: 'using-superpowers' },
        ]);

        const results = await getSuggestions('session-1', '/', { flavor: 'codex' });

        expect(results.map((entry) => entry.insertText ?? entry.text)).toEqual([
            '/compact',
            '$using-superpowers',
        ]);
    });

    it('turns /skills into a Codex skill chooser', async () => {
        mocks.searchSkills.mockResolvedValueOnce([
            { name: 'skill-creator' },
            { name: 'using-superpowers' },
        ]);

        const results = await getSuggestions('session-1', '/skills', { flavor: 'codex' });

        expect(mocks.searchSkills).toHaveBeenCalledWith('session-1', '', { limit: 50 });
        expect(results.map((entry) => entry.insertText ?? entry.text)).toEqual([
            '$skill-creator',
            '$using-superpowers',
        ]);
    });

    it('shows skills when typing $ directly', async () => {
        mocks.searchSkills.mockResolvedValueOnce([
            { name: 'codex-harness' },
        ]);

        const results = await getSuggestions('session-1', '$cod', { flavor: 'codex' });

        expect(results.map((entry) => entry.insertText ?? entry.text)).toEqual(['$codex-harness']);
    });
});
