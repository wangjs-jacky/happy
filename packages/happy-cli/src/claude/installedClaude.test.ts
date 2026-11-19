import { expect, it } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installedClaudeExecutable } from './installedClaude';

it('honors the same explicit CLI override as local mode even when PATH names another installation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paws-claude-override-'));
    const original = process.env.HAPPY_CLAUDE_PATH;
    try {
        const executable = join(directory, 'selected-claude');
        await writeFile(executable, 'fixture');
        process.env.HAPPY_CLAUDE_PATH = executable;
        expect(installedClaudeExecutable()).toBe(await realpath(executable));
    } finally {
        if (original === undefined) delete process.env.HAPPY_CLAUDE_PATH; else process.env.HAPPY_CLAUDE_PATH = original;
        await rm(directory, { recursive: true, force: true });
    }
});
