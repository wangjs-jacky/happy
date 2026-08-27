import { describe, expect, it, vi } from 'vitest';

describe('package root', () => {
    it('exports the SDK without parsing argv or printing output', async () => {
        const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        await import('./index');

        expect(stdout).not.toHaveBeenCalled();
        expect(stderr).not.toHaveBeenCalled();
    });
});
