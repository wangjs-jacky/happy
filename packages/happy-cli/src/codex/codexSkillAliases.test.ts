import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensurePrimaryRuntimeSkillAliases } from './codexSkillAliases';

const roots: string[] = [];

async function home(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'codex-skill-aliases-'));
    roots.push(root);
    return root;
}

async function pluginSkill(root: string, plugin: string, version: string, name: string): Promise<string> {
    const directory = join(root, 'plugins', 'cache', 'openai-primary-runtime', plugin, version, 'skills', name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), `# ${name} ${version}\n`);
    return directory;
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ensurePrimaryRuntimeSkillAliases', () => {
    it('adds missing bundled Skills while preserving existing user directories and links', async () => {
        const root = await home();
        const pdf = await pluginSkill(root, 'pdf', '26.921.11914', 'pdf');
        await pluginSkill(root, 'documents', '26.921.11914', 'documents');
        const userPdf = join(root, 'my-pdf');
        await mkdir(userPdf);
        await writeFile(join(userPdf, 'SKILL.md'), '# user pdf\n');
        await mkdir(join(root, 'skills'));
        await symlink(userPdf, join(root, 'skills', 'pdf'));
        await writeFile(join(root, 'skills', 'custom'), 'user file');

        await ensurePrimaryRuntimeSkillAliases(root);

        expect(await readlink(join(root, 'skills', 'pdf'))).toBe(userPdf);
        expect(await readFile(join(root, 'skills', 'pdf', 'SKILL.md'), 'utf8')).toBe('# user pdf\n');
        expect(await readFile(join(root, 'skills', 'custom'), 'utf8')).toBe('user file');
        expect(await readlink(join(root, 'skills', 'documents'))).toContain('/documents/26.921.11914/skills/documents');
        expect(await readFile(join(pdf, 'SKILL.md'), 'utf8')).toContain('pdf');
    });

    it('refreshes only Happy-managed links when a newer plugin version arrives', async () => {
        const root = await home();
        const oldSkill = await pluginSkill(root, 'pdf', '26.9.1', 'pdf');
        await ensurePrimaryRuntimeSkillAliases(root);
        expect(await readlink(join(root, 'skills', 'pdf'))).toBe(oldSkill);

        const newSkill = await pluginSkill(root, 'pdf', '26.10.1', 'pdf');
        await ensurePrimaryRuntimeSkillAliases(root);
        expect(await readlink(join(root, 'skills', 'pdf'))).toBe(newSkill);

        await pluginSkill(root, 'pdf', '26.11.1', 'pdf');
        await rm(join(root, 'skills', 'pdf'));
        await symlink(oldSkill, join(root, 'skills', 'pdf'));
        await ensurePrimaryRuntimeSkillAliases(root);
        expect(await readlink(join(root, 'skills', 'pdf'))).toBe(oldSkill);
    });

    it('does not expose an ambiguous flat name from two plugin bundles', async () => {
        const root = await home();
        await pluginSkill(root, 'first', '1.0.0', 'shared');
        await pluginSkill(root, 'second', '1.0.0', 'shared');
        await ensurePrimaryRuntimeSkillAliases(root);
        await expect(readlink(join(root, 'skills', 'shared'))).rejects.toThrow();
    });

    it('does not write through a user-owned skills root symlink', async () => {
        const root = await home();
        const external = await home();
        await pluginSkill(root, 'pdf', '1.0.0', 'pdf');
        await symlink(external, join(root, 'skills'));

        await ensurePrimaryRuntimeSkillAliases(root);

        await expect(readlink(join(external, 'pdf'))).rejects.toThrow();
        expect(await readlink(join(root, 'skills'))).toBe(external);
    });
});
