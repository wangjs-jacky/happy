import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportSessionHtml, renderSessionHtml } from './localHtml';
import { createTemporaryDirectory, removeTemporaryDirectory } from './testSupport/temporaryDirectory';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(removeTemporaryDirectory));
});

describe('local HTML session export', () => {
    it('renders the shared snapshot contract and attachments into one offline read-only document', async () => {
        const directory = await createTemporaryDirectory('paws-share-html-');
        temporaryDirectories.push(directory);
        const outputPath = join(directory, 'session.html');

        const result = await exportSessionHtml({
            candidate: { provider: 'codex', path: resolve('test/fixtures/codex-session.jsonl') },
            outputPath,
        });
        const html = await readFile(outputPath, 'utf8');

        expect(result).toMatchObject({
            outputPath,
            source: 'codex',
            title: 'Create a purple Paws sharing illustration.',
            messageCount: 4,
            attachmentCount: 1,
        });
        expect(result.bytes).toBe(Buffer.byteLength(html));
        expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
        expect(html).toContain('<!doctype html>');
        expect(html).toContain('Content-Security-Policy');
        expect(html).toContain('Create a purple Paws sharing illustration.');
        expect(html).toContain('data:image/svg+xml;base64,');
        expect(html).toContain('<details class="thinking"');
        expect(html).toContain('<details class="tool"');
        expect(html).toContain('id="transcript-search"');
        expect(html).not.toContain('src="http');
        expect(html).not.toContain('href="http');
        expect(html).not.toContain('message-composer');
        expect(html).not.toContain('desktop-left-sidebar');
        expect(html).not.toContain('desktop-right-panel');
        expect(html.indexOf('data-message-id="codex-user-1"'))
            .toBeLessThan(html.indexOf('data-message-id="codex-assistant-1"'));
    });

    it('exports a Claude Code snapshot and its attachment through the same local HTML seam', async () => {
        const directory = await createTemporaryDirectory('paws-share-html-claude-');
        temporaryDirectories.push(directory);
        const outputPath = join(directory, 'claude-session.html');

        const result = await exportSessionHtml({
            candidate: { provider: 'claude-code', path: resolve('test/fixtures/claude-code-session.jsonl') },
            outputPath,
        });
        const html = await readFile(outputPath, 'utf8');

        expect(result).toMatchObject({
            source: 'claude-code',
            title: 'Review this Paws sharing illustration.',
            messageCount: 3,
            attachmentCount: 1,
        });
        expect(html).toContain('Claude Code');
        expect(html).toContain('data:image/svg+xml;base64,');
        expect(html).toContain('<details class="thinking"');
        expect(html).toContain('<details class="tool"');
    });

    it('embeds an exact Happy-staged attachment from an explicitly trusted root', async () => {
        const directory = await createTemporaryDirectory('paws-share-html-happy-root-');
        temporaryDirectories.push(directory);
        const sessionDirectory = join(directory, 'sessions');
        const attachmentDirectory = join(directory, '.happy', 'attachments');
        await mkdir(sessionDirectory);
        await mkdir(attachmentDirectory, { recursive: true });
        const transcriptPath = join(sessionDirectory, 'session.jsonl');
        const attachmentPath = join(attachmentDirectory, 'current-upload.png');
        const outputPath = join(directory, 'session.html');
        const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
        await writeFile(attachmentPath, png);
        await writeFile(transcriptPath, [
            JSON.stringify({ type: 'session_meta', payload: { cwd: '/' } }),
            JSON.stringify({
                type: 'response_item', timestamp: '2026-09-01T00:00:00.000Z',
                payload: {
                    id: 'message-1', type: 'message', role: 'user', content: [
                        { type: 'input_text', text: 'Export this Happy attachment.' },
                        { type: 'input_image', path: attachmentPath },
                    ],
                },
            }),
        ].join('\n'));

        const result = await exportSessionHtml({
            candidate: { provider: 'codex', path: transcriptPath, attachmentRoots: [attachmentDirectory] },
            outputPath,
        });

        expect(result.attachmentCount).toBe(1);
        expect(await readFile(outputPath, 'utf8')).toContain(`data:image/png;base64,${png.toString('base64')}`);
    });

    it('renders Happy audio, video, and file notices as offline media and downloads', async () => {
        const directory = await createTemporaryDirectory('paws-share-html-media-');
        temporaryDirectories.push(directory);
        const sessionDirectory = join(directory, 'sessions');
        const attachmentDirectory = join(directory, '.happy', 'attachments');
        await mkdir(sessionDirectory);
        await mkdir(attachmentDirectory, { recursive: true });
        const transcriptPath = join(sessionDirectory, 'session.jsonl');
        const outputPath = join(directory, 'session.html');
        const audioPath = join(attachmentDirectory, 'voice.mp3');
        const videoPath = join(attachmentDirectory, 'demo.mp4');
        const documentPath = join(attachmentDirectory, 'plan.pdf');
        await writeFile(audioPath, Buffer.from('audio'));
        await writeFile(videoPath, Buffer.from('video'));
        await writeFile(documentPath, Buffer.from('%PDF'));
        const notice = [
            'Happy attached 3 user-uploaded local files to this turn:',
            `- Audio 1: ${audioPath} (audio/mpeg, 5B)`,
            `- Video 2: ${videoPath} (video/mp4, 5B)`,
            `- File 3: ${documentPath} (application/pdf, 4B)`,
            'Use the exact local file path above to read or process the PDF according to the user request.',
            'Audio/video content is available at the exact paths above; use command-line tools such as ffmpeg or whisper when needed.',
            'Do not scan ~/.happy/attachments or guess which file the user intended.',
            '',
            'Review all three attachments.',
        ].join('\n');
        await writeFile(transcriptPath, `${JSON.stringify({
            type: 'response_item', timestamp: '2026-09-01T00:00:00.000Z',
            payload: { id: 'message-1', type: 'message', role: 'user', content: [{ type: 'input_text', text: notice }] },
        })}\n`);

        const result = await exportSessionHtml({
            candidate: { provider: 'codex', path: transcriptPath, attachmentRoots: [attachmentDirectory] },
            outputPath,
        });
        const html = await readFile(outputPath, 'utf8');

        expect(result.attachmentCount).toBe(3);
        expect(html).toContain('<audio controls');
        expect(html).toContain('<video controls');
        expect(html).toContain('download="plan.pdf"');
        expect(html).toContain('Review all three attachments.');
        expect(html).not.toContain(attachmentDirectory);
    });

    it('escapes active HTML and rejects unsafe markdown link protocols', () => {
        const html = renderSessionHtml({
            version: 1,
            title: '</title><script>bad()</script>',
            sharedAt: 1_788_000_000_000,
            source: { provider: 'codex' },
            messages: [{
                id: 'message-1',
                role: 'assistant',
                createdAt: 1_788_000_000_000,
                blocks: [{
                    type: 'text',
                    markdown: '<img src=x onerror=bad()> [bad](javascript:bad()) [safe](https://example.com)',
                }],
            }],
        }, []);

        expect(html).not.toContain('</title><script>bad()');
        expect(html).not.toContain('<img src=x');
        expect(html).not.toContain('href="javascript:');
        expect(html).toContain('&lt;img src=x onerror=bad()&gt;');
        expect(html).toContain('href="https://example.com/"');
    });

    it('refuses to overwrite an existing file unless overwrite is explicit', async () => {
        const directory = await createTemporaryDirectory('paws-share-html-existing-');
        temporaryDirectories.push(directory);
        const outputPath = join(directory, 'session.html');
        await writeFile(outputPath, 'keep me');

        await expect(exportSessionHtml({
            candidate: { provider: 'codex', path: resolve('test/fixtures/codex-session.jsonl') },
            outputPath,
        })).rejects.toThrow('already exists');
        expect(await readFile(outputPath, 'utf8')).toBe('keep me');

        await exportSessionHtml({
            candidate: { provider: 'codex', path: resolve('test/fixtures/codex-session.jsonl') },
            outputPath,
            overwrite: true,
        });
        expect(await readFile(outputPath, 'utf8')).toContain('<!doctype html>');
    });

    it('keeps the existing secret policy for a local file that may be shared later', async () => {
        const directory = await createTemporaryDirectory('paws-share-html-sensitive-');
        temporaryDirectories.push(directory);
        const transcriptPath = join(directory, 'sensitive.jsonl');
        const outputPath = join(directory, 'sensitive.html');
        await writeFile(transcriptPath, [
            JSON.stringify({
                timestamp: '2026-09-01T00:00:00.000Z',
                type: 'session_meta',
                payload: { id: 'private-session', cwd: directory, timestamp: '2026-09-01T00:00:00.000Z' },
            }),
            JSON.stringify({
                timestamp: '2026-09-01T00:00:01.000Z',
                type: 'response_item',
                payload: {
                    id: 'user-1', type: 'message', role: 'user',
                    content: [{ type: 'input_text', text: 'SERVICE_TOKEN=examplelongcredentialvalue123456789' }],
                },
            }),
        ].join('\n'));

        await expect(exportSessionHtml({
            candidate: { provider: 'codex', path: transcriptPath },
            outputPath,
        })).rejects.toThrow('high-confidence secret');

        await exportSessionHtml({
            candidate: { provider: 'codex', path: transcriptPath },
            outputPath,
            allowSensitive: true,
        });
        expect(await readFile(outputPath, 'utf8')).toContain('SERVICE_TOKEN=examplelongcredentialvalue123456789');
    });

    it('fails closed before writing when transcript metadata points outside trusted attachment roots', async () => {
        const directory = await createTemporaryDirectory('paws-share-html-root-');
        temporaryDirectories.push(directory);
        const sessionDirectory = join(directory, 'session');
        const privateDirectory = join(directory, 'private');
        await mkdir(sessionDirectory);
        await mkdir(privateDirectory);
        const transcriptPath = join(sessionDirectory, 'session.jsonl');
        const outputPath = join(directory, 'session.html');
        const sentinel = join(privateDirectory, 'sentinel');
        await writeFile(sentinel, 'must not be embedded');
        await writeFile(transcriptPath, [
            JSON.stringify({ type: 'session_meta', payload: { cwd: '/' } }),
            JSON.stringify({
                type: 'response_item', timestamp: '2026-09-01T00:00:00.000Z',
                payload: {
                    id: 'message-1', type: 'message', role: 'user', content: [
                        { type: 'input_text', text: 'Export this attachment.' },
                        { type: 'input_image', path: sentinel },
                    ],
                },
            }),
        ].join('\n'));

        await expect(exportSessionHtml({
            candidate: { provider: 'codex', path: transcriptPath },
            outputPath,
        })).rejects.toThrow('structured attachment(s) could not be resolved');
        await expect(stat(outputPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
