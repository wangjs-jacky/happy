import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { installSlashCommand } from './attach';
import { promptInstallSlashCommandIfNeeded } from './pawsInstallPrompt';

function ttyRuntime(homeDir: string, answer: string) {
  const logs: string[] = [];
  return {
    homeDir,
    stdin: { isTTY: true } as NodeJS.ReadStream,
    stdout: { isTTY: true } as NodeJS.WriteStream,
    env: {},
    ask: vi.fn(async () => answer),
    log: (message: string) => logs.push(message),
    logs,
  };
}

describe('promptInstallSlashCommandIfNeeded', () => {
  it('installs /paws when an interactive user confirms the startup prompt', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happy-paws-prompt-home-'));
    const runtime = ttyRuntime(homeDir, 'y');

    const result = await promptInstallSlashCommandIfNeeded(runtime);

    expect(result).toBe('installed');
    expect(runtime.ask).toHaveBeenCalledWith(expect.stringContaining('/paws'));
    await expect(readFile(join(homeDir, '.codex', 'skills', 'paws', 'SKILL.md'), 'utf8'))
      .resolves.toContain('happy attach --json');
    expect(runtime.logs.join('\n')).toContain('Installed /paws');
  });

  it('does not prompt again when /paws is already installed', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happy-paws-prompt-home-'));
    await installSlashCommand({ homeDir });
    const runtime = ttyRuntime(homeDir, 'y');

    const result = await promptInstallSlashCommandIfNeeded(runtime);

    expect(result).toBe('already-installed');
    expect(runtime.ask).not.toHaveBeenCalled();
  });

  it('skips the prompt for daemon-started sessions and non-interactive shells', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happy-paws-prompt-home-'));

    await expect(promptInstallSlashCommandIfNeeded({
      ...ttyRuntime(homeDir, 'y'),
      startedBy: 'daemon',
    })).resolves.toBe('skipped');

    await expect(promptInstallSlashCommandIfNeeded({
      ...ttyRuntime(homeDir, 'y'),
      stdin: { isTTY: false } as NodeJS.ReadStream,
    })).resolves.toBe('skipped');
  });

  it('prints the manual install command when the user declines', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happy-paws-prompt-home-'));
    const runtime = ttyRuntime(homeDir, 'no');

    const result = await promptInstallSlashCommandIfNeeded(runtime);

    expect(result).toBe('declined');
    expect(runtime.logs.join('\n')).toContain('happy attach --install-slash-command');
  });
});
