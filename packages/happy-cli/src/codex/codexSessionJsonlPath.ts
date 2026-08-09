import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolveCodexHome } from './codexHome';

/**
 * Resolves the on-disk Codex transcript for a thread without reconstructing
 * filenames. Codex owns the dated directory and timestamp portions of the
 * filename, so the thread ID is the only reliable lookup key.
 */
export function findCodexSessionJsonlPath(threadId: string, codexHome = resolveCodexHome()): string | undefined {
    const sessionsDirectory = join(codexHome, 'sessions');
    if (!existsSync(sessionsDirectory)) {
        return undefined;
    }

    try {
        const matchingEntries = readdirSync(sessionsDirectory, { recursive: true })
            .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith(`-${threadId}.jsonl`))
            .sort();
        const matchingEntry = matchingEntries.at(-1);
        return matchingEntry ? join(sessionsDirectory, matchingEntry) : undefined;
    } catch {
        // A transcript is an optional diagnostic aid. Do not let an unreadable
        // Codex archive prevent a session from starting or resuming.
        return undefined;
    }
}
