import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ homeRoot: '/nonexistent-fixture-home' }));
vi.mock('./ops', () => ({ machineBash: async (_id: string, opts: { command: string; cwd: string }) => ({ success: true, stdout: execFileSync('bash', ['-c', opts.command.replaceAll('"$HOME/', '"' + mocks.homeRoot + '/')], { cwd: opts.cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }) }) }));
import { scanSkills } from './skills';
it('checks ancestor project Skills using the same canonical paths as the CLI, including file symlinks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'happy-agent-scan-'));
    try {
        mocks.homeRoot = join(dir, 'fixture-home');
        const child = join(dir, 'project/nested');mkdirSync(child, { recursive: true });
        const skills = join(dir, '.agents/skills/linked');mkdirSync(skills, { recursive: true });
        const realFile = join(dir, 'actual-method.md');writeFileSync(realFile, '---\nname: canonical-test-method\ndescription: test\n---\n');
        symlinkSync(realFile, join(skills, 'SKILL.md'));
        const entries = await scanSkills('fixture', { cwd: child });
        expect(entries.find(s => s.name === 'canonical-test-method')).toMatchObject({ path: realpathSync(realFile) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
