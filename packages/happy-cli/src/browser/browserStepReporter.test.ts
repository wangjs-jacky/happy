import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    MAX_BROWSER_STEP_IMAGE_BYTES,
    createBrowserStepReporter,
    validateBrowserStepScreenshot,
} from './browserStepReporter';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'happy-browser-step-test-'));
    dirs.push(dir);
    return dir;
}

async function writePng(filePath: string): Promise<void> {
    await writeFile(filePath, new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ]));
}

afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('validateBrowserStepScreenshot', () => {
    it('accepts absolute PNG and JPEG paths', async () => {
        const dir = await tempDir();
        const pngPath = join(dir, 'step.png');
        const jpegPath = join(dir, 'step.jpg');
        await writePng(pngPath);
        await writeFile(jpegPath, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));

        await expect(validateBrowserStepScreenshot(pngPath)).resolves.toMatchObject({ mimeType: 'image/png' });
        await expect(validateBrowserStepScreenshot(jpegPath)).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    });

    it('rejects relative, missing, unsupported, and oversized files with stable codes', async () => {
        await expect(validateBrowserStepScreenshot('step.png')).rejects.toThrow('INVALID_SCREENSHOT_PATH');
        await expect(validateBrowserStepScreenshot(join(tmpdir(), 'happy-browser-step-missing.png')))
            .rejects.toThrow('SCREENSHOT_NOT_FOUND');

        const dir = await tempDir();
        const textPath = join(dir, 'step.txt');
        await writeFile(textPath, 'not an image');
        await expect(validateBrowserStepScreenshot(textPath)).rejects.toThrow('UNSUPPORTED_IMAGE');

        const largePath = join(dir, 'large.png');
        await writePng(largePath);
        await truncate(largePath, MAX_BROWSER_STEP_IMAGE_BYTES + 1);
        await expect(validateBrowserStepScreenshot(largePath)).rejects.toThrow('IMAGE_TOO_LARGE');
    });
});

describe('createBrowserStepReporter', () => {
    it('uploads, emits one browser_step event, and removes a Happy temporary screenshot', async () => {
        const dir = await tempDir();
        const filePath = join(dir, `happy-browser-step-${Date.now()}-success.png`);
        await writePng(filePath);
        const emitted: unknown[] = [];
        const reporter = createBrowserStepReporter({
            uploadImageAttachment: async (path) => {
                expect(path).toBe(filePath);
                return {
                    ref: 'sessions/s1/attachments/a.enc',
                    name: 'step.png',
                    size: (await readFile(path)).byteLength,
                    dims: { width: 1, height: 1 },
                    motionPhoto: null,
                };
            },
            sendFileEvent: (...args) => { emitted.push(args); },
        });

        await expect(reporter.report({ path: filePath, label: '  打开收藏夹  ' }))
            .resolves.toEqual({ success: true });
        expect(emitted).toEqual([[
            'sessions/s1/attachments/a.enc',
            'step.png',
            expect.any(Number),
            { width: 1, height: 1 },
            { source: 'browser_step', browserStep: { label: '打开收藏夹' } },
        ]]);
        await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('keeps the local screenshot and classifies upload failures', async () => {
        const dir = await tempDir();
        const filePath = join(dir, `happy-browser-step-${Date.now()}-upload-failed.png`);
        await writePng(filePath);
        const reporter = createBrowserStepReporter({
            uploadImageAttachment: async () => { throw new Error('offline'); },
            sendFileEvent: () => { throw new Error('must not emit'); },
        });

        await expect(reporter.report({ path: filePath, label: '打开收藏夹' }))
            .resolves.toEqual({ success: false, error: 'UPLOAD_FAILED: offline' });
        expect((await stat(filePath)).isFile()).toBe(true);
    });

    it('keeps the local screenshot and classifies event delivery failures', async () => {
        const dir = await tempDir();
        const filePath = join(dir, `happy-browser-step-${Date.now()}-event-failed.png`);
        await writePng(filePath);
        const reporter = createBrowserStepReporter({
            uploadImageAttachment: async () => ({
                ref: 'sessions/s1/attachments/a.enc',
                name: 'step.png',
                size: 24,
                dims: { width: 1, height: 1 },
                motionPhoto: null,
            }),
            sendFileEvent: () => { throw new Error('socket closed'); },
        });

        await expect(reporter.report({ path: filePath, label: '打开收藏夹' }))
            .resolves.toEqual({ success: false, error: 'EVENT_SEND_FAILED: socket closed' });
        expect((await stat(filePath)).isFile()).toBe(true);
    });
});
