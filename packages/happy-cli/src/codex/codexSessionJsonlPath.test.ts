import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findCodexSessionJsonlPath } from './codexSessionJsonlPath';

describe('findCodexSessionJsonlPath', () => {
    it('finds the dated transcript belonging to the Codex thread', () => {
        const codexHome = mkdtempSync(join(tmpdir(), 'happy-codex-sessions-'));
        const sessionsDirectory = join(codexHome, 'sessions', '2026', '08', '09');
        const threadId = '019fdd66-655e-7e11-a38e-2c98380bc216';
        const jsonlPath = join(sessionsDirectory, `rollout-2026-08-09T08-15-18-${threadId}.jsonl`);
        mkdirSync(sessionsDirectory, { recursive: true });
        writeFileSync(jsonlPath, '{}\n');
        writeFileSync(join(sessionsDirectory, 'rollout-2026-08-09T08-15-18-other-thread.jsonl'), '{}\n');

        expect(findCodexSessionJsonlPath(threadId, codexHome)).toBe(jsonlPath);
    });

    it('returns undefined when Codex has not created a transcript for the thread', () => {
        const codexHome = mkdtempSync(join(tmpdir(), 'happy-codex-sessions-'));

        expect(findCodexSessionJsonlPath('missing-thread', codexHome)).toBeUndefined();
    });
});
