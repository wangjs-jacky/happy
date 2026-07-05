import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  inheritCodexHomeConfiguration,
  shouldInheritCodexHomeEntry,
} from './codexHomeInheritance';

const tmpRoots: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('codexHomeInheritance', () => {
  it('selects official Codex config and capability entries', () => {
    expect(shouldInheritCodexHomeEntry('config.toml')).toBe(true);
    expect(shouldInheritCodexHomeEntry('deep-review.config.toml')).toBe(true);
    expect(shouldInheritCodexHomeEntry('AGENTS.md')).toBe(true);
    expect(shouldInheritCodexHomeEntry('skills')).toBe(true);
    expect(shouldInheritCodexHomeEntry('auth.json')).toBe(false);
    expect(shouldInheritCodexHomeEntry('sessions')).toBe(false);
  });

  it('links config entries into a temporary CODEX_HOME without copying auth state', async () => {
    const source = await makeTempDir('codex-home-source-');
    const target = await makeTempDir('codex-home-target-');

    await writeFile(join(source, 'config.toml'), 'model = "gpt-5.4"\n');
    await writeFile(join(source, 'review.config.toml'), 'model_reasoning_effort = "xhigh"\n');
    await writeFile(join(source, 'AGENTS.md'), '# instructions\n');
    await writeFile(join(source, 'auth.json'), '{"token":"do-not-link"}\n');
    await mkdir(join(source, 'skills'));
    await writeFile(join(source, 'skills', 'SKILL.md'), '# skill\n');

    await inheritCodexHomeConfiguration(target, { sourceCodexHome: source });

    await expect(readFile(join(target, 'auth.json'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(target, 'config.toml'), 'utf8')).resolves.toContain('gpt-5.4');
    await expect(readFile(join(target, 'review.config.toml'), 'utf8')).resolves.toContain('xhigh');
    await expect(readFile(join(target, 'AGENTS.md'), 'utf8')).resolves.toContain('instructions');
    await expect(readFile(join(target, 'skills', 'SKILL.md'), 'utf8')).resolves.toContain('skill');

    if (process.platform !== 'win32') {
      await expect(readlink(join(target, 'config.toml'))).resolves.toBe(join(source, 'config.toml'));
    }
  });
});
