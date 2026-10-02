import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { listCodexSkillEntries, listCodexSkillNames } from './codexSkills';

function writeSkill(root: string, relativePath: string, frontmatterName?: string): void {
    const filePath = join(root, relativePath);
    mkdirSync(filePath.replace(/\/SKILL\.md$/, ''), { recursive: true });
    const body = frontmatterName
        ? `---\nname: "${frontmatterName}"\ndescription: "desc"\n---\n`
        : `---\ndescription: "desc"\n---\n`;
    writeFileSync(filePath, body, 'utf8');
}

describe('listCodexSkillNames', () => {
    const created: string[] = [];

    afterEach(() => {
        for (const dir of created.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('collects global, local, nested system, and plugin skill names', () => {
        const homeDir = mkdtempSync(join(tmpdir(), 'codex-skills-home-'));
        const repoRoot = mkdtempSync(join(tmpdir(), 'codex-skills-repo-'));
        created.push(homeDir, repoRoot);

        const cwd = join(repoRoot, 'packages', 'happy-cli');
        mkdirSync(cwd, { recursive: true });

        writeSkill(homeDir, '.codex/skills/brainstorming/SKILL.md', 'brainstorming');
        writeSkill(homeDir, '.codex/skills/.system/openai-docs/SKILL.md', 'openai-docs');
        writeSkill(homeDir, '.agents/skills/agent-browser/SKILL.md', 'agent-browser');
        writeSkill(repoRoot, '.agents/skills/dev/SKILL.md', 'dev');
        writeSkill(
            homeDir,
            '.codex/plugins/cache/openai-curated-remote/supabase/1.0.0/skills/supabase/SKILL.md',
            'supabase',
        );

        expect(listCodexSkillNames({ cwd, homeDir })).toEqual([
            'agent-browser',
            'brainstorming',
            'dev',
            'openai-docs',
            'supabase:supabase',
        ]);
    });

    it('dedupes repeated names across roots', () => {
        const homeDir = mkdtempSync(join(tmpdir(), 'codex-skills-home-'));
        const repoRoot = mkdtempSync(join(tmpdir(), 'codex-skills-repo-'));
        created.push(homeDir, repoRoot);

        const cwd = join(repoRoot, 'apps', 'mobile');
        mkdirSync(cwd, { recursive: true });

        writeSkill(homeDir, '.codex/skills/find-skills/SKILL.md', 'find-skills');
        writeSkill(repoRoot, '.agents/skills/find-skills/SKILL.md', 'find-skills');

        expect(listCodexSkillNames({ cwd, homeDir })).toEqual(['find-skills']);
    });

    it('discovers Claude personal and plugin Skills with canonical paths shared by save and launch validation', () => {
        const homeDir = mkdtempSync(join(tmpdir(), 'agent-skills-home-'));
        created.push(homeDir);
        writeSkill(homeDir, '.claude/skills/claude-only/SKILL.md', 'claude-only');
        writeSkill(homeDir, '.claude/plugins/cache/community/advisor/1.0.0/skills/decision/SKILL.md', 'decision');
        writeSkill(homeDir, '.codex/skills/codex-only/SKILL.md', 'codex-only');
        mkdirSync(join(homeDir, '.agents/skills'), { recursive: true });
        symlinkSync(join(homeDir, '.claude/skills/claude-only'), join(homeDir, '.agents/skills/linked-claude'), 'junction');
        const entries = listCodexSkillEntries({ cwd: homeDir, homeDir });
        expect(entries.map(s => s.name)).toEqual(['advisor:decision', 'claude-only', 'codex-only']);
        expect(entries.find(s => s.name === 'claude-only')).toMatchObject({
            path: realpathSync(join(homeDir, '.claude/skills/claude-only/SKILL.md')), description: 'desc',
        });
        expect(entries.find(s => s.name === 'advisor:decision')?.path).toBe(realpathSync(join(homeDir, '.claude/plugins/cache/community/advisor/1.0.0/skills/decision/SKILL.md')));
    });

    it('falls back to the directory name when frontmatter name is missing', () => {
        const homeDir = mkdtempSync(join(tmpdir(), 'codex-skills-home-'));
        created.push(homeDir);

        writeSkill(homeDir, '.codex/skills/no-frontmatter-name/SKILL.md');

        expect(listCodexSkillNames({ cwd: homeDir, homeDir })).toEqual(['no-frontmatter-name']);
    });
});
