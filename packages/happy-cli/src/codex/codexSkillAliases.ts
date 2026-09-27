import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MANIFEST_NAME = '.happy-primary-runtime-skill-links.json';

async function entries(path: string) {
    try {
        return await readdir(path, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
}

async function existingLink(path: string): Promise<string | null | undefined> {
    try {
        if (!(await lstat(path)).isSymbolicLink()) return null;
        return await readlink(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

async function readManifest(path: string): Promise<Record<string, string>> {
    try {
        const value: unknown = JSON.parse(await readFile(path, 'utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return {};
        throw error;
    }
}

/**
 * Give Codex's bundled plugin Skills a flat fallback path. Codex sometimes
 * reads $CODEX_HOME/skills/<name> even when its catalog contains a plugin path.
 * Only aliases created by Happy are refreshed; existing user entries win.
 */
export async function ensurePrimaryRuntimeSkillAliases(sourceHome: string): Promise<void> {
    const runtimeRoot = join(sourceHome, 'plugins', 'cache', 'openai-primary-runtime');
    const aliases = new Map<string, string>();
    const ambiguous = new Set<string>();

    for (const plugin of await entries(runtimeRoot)) {
        if (!plugin.isDirectory()) continue;
        const pluginRoot = join(runtimeRoot, plugin.name);
        const versions = (await entries(pluginRoot))
            .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+)+$/.test(entry.name))
            .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
        if (versions.length === 0) continue;

        const skillsRoot = join(pluginRoot, versions[0].name, 'skills');
        for (const skill of await entries(skillsRoot)) {
            if (!skill.isDirectory()) continue;
            const skillRoot = join(skillsRoot, skill.name);
            if (!(await stat(join(skillRoot, 'SKILL.md')).catch(() => null))?.isFile()) continue;
            if (aliases.has(skill.name)) ambiguous.add(skill.name);
            else aliases.set(skill.name, skillRoot);
        }
    }

    if (aliases.size === 0) return;
    const skillsRoot = join(sourceHome, 'skills');
    // A user may point the entire skills root at another repository. Do not
    // write new entries through that link into a directory Happy does not own.
    if ((await lstat(skillsRoot).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }))?.isSymbolicLink()) return;
    await mkdir(skillsRoot, { recursive: true });
    const manifestPath = join(sourceHome, MANIFEST_NAME);
    const managed = await readManifest(manifestPath);
    let changed = false;

    for (const [name, target] of aliases) {
        if (ambiguous.has(name)) continue;
        const link = join(skillsRoot, name);
        const current = await existingLink(link);
        if (current === null || (current !== undefined && current !== managed[name])) continue;
        if (current === target) continue;

        if (current === undefined) {
            try {
                await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
                throw error;
            }
        } else {
            const replacement = join(skillsRoot, `.happy-skill-${randomUUID()}`);
            await symlink(target, replacement, process.platform === 'win32' ? 'junction' : 'dir');
            try {
                await rename(replacement, link);
            } finally {
                await rm(replacement, { force: true });
            }
        }
        managed[name] = target;
        changed = true;
    }

    if (changed) {
        const temporary = join(sourceHome, `${MANIFEST_NAME}.${randomUUID()}`);
        await writeFile(temporary, JSON.stringify(managed), { mode: 0o600, flag: 'wx' });
        try {
            await rename(temporary, manifestPath);
        } finally {
            await rm(temporary, { force: true });
        }
    }
}
