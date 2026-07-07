import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
    buildCodexImagePrompt,
    findNewImage,
    parseCommand,
    resolveDefaultCodexCommand,
    type NativeCodexImageRequest,
} from './nativeCodexCommand';

describe('native Codex image command helpers', () => {
    it('builds a fixed image-only prompt around the public prompt', () => {
        const request: NativeCodexImageRequest = {
            jobId: 'job_123',
            prompt: 'draw a calm product render',
            options: {
                size: '1024x1024',
                output: 'png',
                count: 1,
            },
        };

        const prompt = buildCodexImagePrompt(request);

        expect(prompt).toContain('job_123');
        expect(prompt).toContain('draw a calm product render');
        expect(prompt).toContain('Generate exactly one PNG image');
        expect(prompt).toContain('Do not run shell commands');
        expect(prompt).toContain('1024x1024');
    });

    it('parses quoted command arguments without using a shell', () => {
        expect(parseCommand('codex exec --model "gpt-5.5"')).toEqual([
            'codex',
            'exec',
            '--model',
            'gpt-5.5',
        ]);
    });

    it('uses Codex exec with the supported read-only sandbox flags by default', () => {
        const command = resolveDefaultCodexCommand();

        expect(command).toContain(' exec ');
        expect(command).toContain('--skip-git-repo-check');
        expect(command).toContain('--sandbox read-only');
        expect(command).not.toContain('--ask-for-approval');
    });

    it('finds the newest image created after the previous snapshot', async () => {
        const root = join(tmpdir(), `happy-native-codex-${Date.now()}`);
        const oldDir = join(root, 'old');
        const newDir = join(root, 'new');
        await mkdir(oldDir, { recursive: true });
        await mkdir(newDir, { recursive: true });
        const oldImage = join(oldDir, 'old.png');
        const newImage = join(newDir, 'new.png');
        await writeFile(oldImage, 'old');
        const before = new Set([oldImage]);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await writeFile(newImage, 'new');

        await expect(findNewImage(root, before)).resolves.toBe(newImage);
    });
});
