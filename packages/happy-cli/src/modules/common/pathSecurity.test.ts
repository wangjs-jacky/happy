import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { validatePath, validateReadPath } from './pathSecurity';
import { homedir } from 'os';
import { join } from 'path';

describe('validatePath', () => {
    const workingDir = resolve('/home/user/project');

    it('should allow paths within working directory', () => {
        expect(validatePath(resolve('/home/user/project/file.txt'), workingDir)).toEqual({
            valid: true,
            resolvedPath: resolve('/home/user/project/file.txt'),
        });
        expect(validatePath('file.txt', workingDir)).toEqual({
            valid: true,
            resolvedPath: resolve('/home/user/project/file.txt'),
        });
        expect(validatePath('./src/file.txt', workingDir)).toEqual({
            valid: true,
            resolvedPath: resolve('/home/user/project/src/file.txt'),
        });
    });

    it('should reject paths outside working directory', () => {
        const result = validatePath(resolve('/etc/passwd'), workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the working directory');
    });

    it('should prevent path traversal attacks', () => {
        const result = validatePath('../../.ssh/id_rsa', workingDir);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('outside the working directory');
    });

    it('should allow the working directory itself', () => {
        expect(validatePath('.', workingDir)).toEqual({
            valid: true,
            resolvedPath: resolve('/home/user/project'),
        });
        expect(validatePath(workingDir, workingDir)).toEqual({
            valid: true,
            resolvedPath: resolve('/home/user/project'),
        });
    });
});

describe('validateReadPath', () => {
    const home = homedir();
    const cwd = join(home, 'projects', 'demo');

    it('allows an absolute path anywhere inside home', () => {
        expect(validateReadPath(join(home, 'other', 'file.ts'), cwd, home).valid).toBe(true);
    });

    it('allows the containment root itself', () => {
        expect(validateReadPath(home, cwd, home).valid).toBe(true);
    });

    it('resolves relative paths against the working directory', () => {
        const r = validateReadPath('src/index.ts', cwd, home);
        expect(r.valid).toBe(true);
        expect(r.resolvedPath).toBe(join(cwd, 'src/index.ts'));
    });

    it('denies an absolute path outside home', () => {
        expect(validateReadPath('/etc/passwd', cwd, home).valid).toBe(false);
    });

    it('denies traversal that escapes home', () => {
        expect(validateReadPath(join(home, '..', 'someone-else'), cwd, home).valid).toBe(false);
    });
});
