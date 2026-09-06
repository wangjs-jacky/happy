import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewWorkspaceRegistry } from './previewWorkspace';

describe('PreviewWorkspaceRegistry', () => {
    const roots: string[] = [];
    afterEach(async () => { for (const root of roots) await import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true })); roots.length = 0; });
    async function registry() { const root = await mkdtemp(join(tmpdir(), 'happy-preview-test-')); roots.push(root); return new PreviewWorkspaceRegistry(root); }

    it('creates a session-owned empty workspace and returns a validated manifest', async () => {
        const value = await registry(); const created = await value.create('session-1', 'Toolbar');
        await writeFile(join(created.path, 'index.html'), '<h1>Hello</h1>');
        await mkdir(join(created.path, 'assets')); await writeFile(join(created.path, 'assets', 'app.js'), 'alert(1)');
        const resolved = await value.resolveForPublish('session-1', created.previewId);
        expect(resolved.manifest.title).toBe('Toolbar'); expect(resolved.manifest.assets.map((a) => a.path)).toEqual(['assets/app.js', 'index.html']);
        expect(resolved.files.every((file) => file.absolutePath.startsWith(created.path))).toBe(true);
    });

    it('rejects cross-session access, symlinks, hidden files, and a missing root index', async () => {
        const value = await registry(); const created = await value.create('session-1', 'Unsafe');
        await expect(value.resolveForPublish('session-2', created.previewId)).rejects.toThrow(/workspace/i);
        await writeFile(join(created.path, '.secret'), 'x'); await expect(value.resolveForPublish('session-1', created.previewId)).rejects.toThrow(/hidden/i);
        await import('node:fs/promises').then((fs) => fs.unlink(join(created.path, '.secret')));
        await symlink('/etc/hosts', join(created.path, 'index.html')); await expect(value.resolveForPublish('session-1', created.previewId)).rejects.toThrow(/symbolic/i);
    });
});
