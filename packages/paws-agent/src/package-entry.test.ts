import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('package root', () => {
    it('exports the SDK without parsing argv or printing output', async () => {
        const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        await import('./index');

        expect(stdout).not.toHaveBeenCalled();
        expect(stderr).not.toHaveBeenCalled();
    });

    it('keeps root and browser bundles free of Node built-ins', async () => {
        const bundles = await Promise.all([
            readFile(new URL('../dist/index.mjs', import.meta.url), 'utf8'),
            readFile(new URL('../dist/browser.mjs', import.meta.url), 'utf8'),
        ]);

        for (const bundle of bundles) {
            expect(bundle).not.toMatch(/(?:from\s+|import\s*)['"]node:/);
            expect(bundle).not.toContain('Buffer.from');
        }
    });
});
