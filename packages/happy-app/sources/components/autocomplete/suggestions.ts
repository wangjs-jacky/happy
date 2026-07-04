import { CommandSuggestion, FileMentionSuggestion, SkillSuggestion } from '@/components/AgentInputSuggestionView';
import type { ComposerAutocompleteSuggestion } from './types';
import * as React from 'react';
import { searchFiles, FileItem } from '@/sync/suggestionFile';
import { searchCommands, CommandItem } from '@/sync/suggestionCommands';
import { searchSkills, SkillItem } from '@/sync/suggestionSkills';

const COMMAND_LIMIT = 50;
const SKILL_LIMIT = 50;

function isCodexFlavor(flavor: string | null | undefined): boolean {
    return flavor === 'codex' || flavor === 'openai' || flavor === 'gpt';
}

function isCodexSkillsChooserQuery(query: string): boolean {
    return query.trim().toLowerCase() === '/skills';
}

function dedupeSuggestions(items: ComposerAutocompleteSuggestion[]): ComposerAutocompleteSuggestion[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const key = item.insertText ?? item.text;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

export async function getCommandSuggestions(sessionId: string, query: string): Promise<ComposerAutocompleteSuggestion[]> {
    // Remove the "/" prefix for searching
    const searchTerm = query.slice(1);

    try {
        // Use the command search cache with fuzzy matching
        const commands = await searchCommands(sessionId, searchTerm, { limit: COMMAND_LIMIT });

        // Convert CommandItem to suggestion format
        return commands.map((cmd: CommandItem) => ({
            key: `cmd-${cmd.command}`,
            text: `/${cmd.command}`,
            insertText: `/${cmd.command}`,
            component: () => React.createElement(CommandSuggestion, {
                command: cmd.command,
                description: cmd.description
            })
        }));
    } catch (error) {
        console.error('Error fetching command suggestions:', error);
        return [];
    }
}

export async function getSkillSuggestions(
    sessionId: string,
    query: string,
    insertPrefix: '$' | '/' = '$',
): Promise<ComposerAutocompleteSuggestion[]> {
    try {
        const skills = await searchSkills(sessionId, query, { limit: SKILL_LIMIT });

        return skills.map((skill: SkillItem) => {
            const syntax = `${insertPrefix}${skill.name}`;
            return {
                key: `skill-${insertPrefix}-${skill.name}`,
                text: syntax,
                insertText: syntax,
                component: () => React.createElement(SkillSuggestion, {
                    syntax,
                }),
            };
        });
    } catch (error) {
        console.error('Error fetching skill suggestions:', error);
        return [];
    }
}

export async function getFileMentionSuggestions(sessionId: string, query: string): Promise<ComposerAutocompleteSuggestion[]> {
    // Remove the "@" prefix for searching
    const searchTerm = query.slice(1);

    try {
        // Use the file search cache with fuzzy matching
        const files = await searchFiles(sessionId, searchTerm, { limit: 50 });

        // Convert FileItem to suggestion format
        return files.map((file: FileItem) => ({
            key: `file-${file.fullPath}`,
            text: `@${file.fullPath}`,
            insertText: `@${file.fullPath}`,
            component: () => React.createElement(FileMentionSuggestion, {
                fileName: file.fileName,
                filePath: file.filePath,
                fileType: file.fileType
            })
        }));
    } catch (error) {
        console.error('Error fetching file suggestions:', error);
        return [];
    }
}

export async function getSuggestions(
    sessionId: string,
    query: string,
    options?: { flavor?: string | null },
): Promise<ComposerAutocompleteSuggestion[]> {
    if (!query || query.length === 0) {
        return [];
    }

    if (query.startsWith('/')) {
        const codex = isCodexFlavor(options?.flavor);
        const skillInsertPrefix = codex ? '$' : '/';

        if (codex && isCodexSkillsChooserQuery(query)) {
            const skills = await getSkillSuggestions(sessionId, '', '$');
            if (skills.length > 0) {
                return skills;
            }
            return getCommandSuggestions(sessionId, query);
        }

        const [commands, skills] = await Promise.all([
            getCommandSuggestions(sessionId, query),
            getSkillSuggestions(sessionId, query, skillInsertPrefix),
        ]);

        const filteredCommands = codex && skills.length > 0
            ? commands.filter((item) => (item.insertText ?? item.text) !== '/skills')
            : commands;

        return dedupeSuggestions([...filteredCommands, ...skills]);
    }

    if (query.startsWith('$')) {
        return getSkillSuggestions(sessionId, query, '$');
    }

    if (query.startsWith('@')) {
        return getFileMentionSuggestions(sessionId, query);
    }

    return [];
}
