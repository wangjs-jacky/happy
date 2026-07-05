import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareCodexHomeWithAuth, resolveCodexHome } from './codexHome';

async function makeTempDir(prefix: string): Promise<string> {
    return mkdtemp(join(tmpdir(), prefix));
}

describe('resolveCodexHome', () => {
    it('defaults to ~/.codex', () => {
        expect(resolveCodexHome({
            env: {},
            homeDir: '/Users/tester',
        })).toBe('/Users/tester/.codex');
    });

    it('respects CODEX_HOME', () => {
        expect(resolveCodexHome({
            env: { CODEX_HOME: '~/custom-codex' },
            homeDir: '/Users/tester',
        })).toBe('/Users/tester/custom-codex');
    });
});

describe('prepareCodexHomeWithAuth', () => {
    it('inherits Codex configuration entries while isolating auth.json', async () => {
        const sourceHome = await makeTempDir('codex-source-');
        const tempHome = await makeTempDir('codex-temp-');

        await writeFile(join(sourceHome, 'auth.json'), 'local-auth');
        await writeFile(join(sourceHome, 'config.toml'), 'model = "gpt-5.5"');
        await writeFile(join(sourceHome, 'work.config.toml'), 'model = "gpt-5.5-mini"');
        await writeFile(join(sourceHome, 'AGENTS.md'), 'global instructions');
        await writeFile(join(sourceHome, 'hooks.json'), '{"hooks":[]}');
        await writeFile(join(sourceHome, 'history.jsonl'), 'do not inherit');
        await mkdir(join(sourceHome, 'skills', 'codex-harness'), { recursive: true });
        await writeFile(join(sourceHome, 'skills', 'codex-harness', 'SKILL.md'), 'harness skill');
        await mkdir(join(sourceHome, 'plugins', 'cache', 'plugin', '1.0.0'), { recursive: true });
        await writeFile(join(sourceHome, 'plugins', 'cache', 'plugin', '1.0.0', 'plugin.json'), '{}');

        const result = await prepareCodexHomeWithAuth('cloud-auth', {
            sourceHome,
            createTempDir: () => tempHome,
        });

        expect(result).toBe(tempHome);
        await expect(readFile(join(tempHome, 'auth.json'), 'utf8')).resolves.toBe('cloud-auth');
        await expect(readFile(join(tempHome, 'config.toml'), 'utf8')).resolves.toBe('model = "gpt-5.5"');
        await expect(readFile(join(tempHome, 'work.config.toml'), 'utf8')).resolves.toBe('model = "gpt-5.5-mini"');
        await expect(readFile(join(tempHome, 'AGENTS.md'), 'utf8')).resolves.toBe('global instructions');
        await expect(readFile(join(tempHome, 'hooks.json'), 'utf8')).resolves.toBe('{"hooks":[]}');
        await expect(readFile(join(tempHome, 'skills', 'codex-harness', 'SKILL.md'), 'utf8')).resolves.toBe('harness skill');
        await expect(readFile(join(tempHome, 'plugins', 'cache', 'plugin', '1.0.0', 'plugin.json'), 'utf8')).resolves.toBe('{}');
        await expect(readFile(join(tempHome, 'history.jsonl'), 'utf8')).rejects.toThrow();
    });

    it('still creates an auth-only Codex home when the source home does not exist', async () => {
        const tempHome = await makeTempDir('codex-auth-only-');
        const result = await prepareCodexHomeWithAuth('cloud-auth', {
            sourceHome: join(tempHome, 'missing-source'),
            createTempDir: () => tempHome,
        });

        expect(result).toBe(tempHome);
        await expect(readFile(join(tempHome, 'auth.json'), 'utf8')).resolves.toBe('cloud-auth');
    });
});
