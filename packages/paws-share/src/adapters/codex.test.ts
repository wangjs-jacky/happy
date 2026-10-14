import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publicSessionSnapshotSchema } from '@slopus/happy-wire';
import { codexAdapter } from './codex';
import { readResolvedAttachmentBytes } from './shared';
import { createTemporaryDirectory, removeTemporaryDirectory } from '../testSupport/temporaryDirectory';

const fixture = resolve('test/fixtures/codex-session.jsonl');
const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(removeTemporaryDirectory));
});

describe('codexAdapter', () => {
    it('converts messages, reasoning, tools, and a structured attachment without private metadata', async () => {
        const converted = await codexAdapter.convert({ provider: 'codex', path: fixture });

        expect(publicSessionSnapshotSchema.parse(converted.snapshot)).toEqual(converted.snapshot);
        expect(converted.snapshot.source).toEqual({ provider: 'codex' });
        expect(converted.snapshot.title).toBe('Create a purple Paws sharing illustration.');
        expect(converted.snapshot.messages[0]).toMatchObject({
            role: 'assistant',
            blocks: [expect.objectContaining({ type: 'text', markdown: 'The illustration is ready and keeps the same aspect ratio.' })],
        });
        expect(converted.snapshot.messages.at(-1)).toMatchObject({ role: 'user' });
        expect(converted.snapshot.messages.flatMap((message) => message.blocks)).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'thinking', markdown: expect.stringContaining('preserve its proportions') }),
            expect.objectContaining({ type: 'tool', name: 'view_image', status: 'completed', body: 'Image is 320 by 180 pixels.' }),
            expect.objectContaining({ type: 'attachment', name: 'attachment.svg', kind: 'image', mimeType: 'image/svg+xml' }),
        ]));
        expect(converted.attachments).toHaveLength(1);
        expect(converted.attachments[0].sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(converted.unresolvedAttachments).toEqual([]);
        expect((await readResolvedAttachmentBytes(converted.attachments[0])).toString('utf8')).toContain('Paws Share');
        expect(JSON.stringify(converted.snapshot)).not.toContain('codex-private-session');
        expect(JSON.stringify(converted.snapshot)).not.toContain(fixture);
    });

    it('exports a structured base64 data URL image', async () => {
        const directory = await createTemporaryDirectory('paws-share-codex-data-image-');
        temporaryDirectories.push(directory);
        const transcript = join(directory, 'session.jsonl');
        const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
        const lines = [{
            type: 'response_item',
            timestamp: '2026-09-01T00:00:00.000Z',
            payload: {
                id: 'message-1',
                type: 'message',
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Share this embedded drawing.' },
                    { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}` },
                ],
            },
        }];
        await writeFile(transcript, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

        const converted = await codexAdapter.convert({ provider: 'codex', path: transcript });

        expect(converted.attachments).toHaveLength(1);
        expect(await readResolvedAttachmentBytes(converted.attachments[0])).toEqual(png);
        expect(converted.unresolvedAttachments).toEqual([]);
    });

    it('does not let transcript metadata authorize attachments outside caller roots', async () => {
        const directory = await createTemporaryDirectory('paws-share-codex-root-');
        temporaryDirectories.push(directory);
        const sessionDirectory = join(directory, 'session');
        const privateDirectory = join(directory, 'private');
        await mkdir(sessionDirectory);
        await mkdir(privateDirectory);
        const transcript = join(sessionDirectory, 'session.jsonl');
        const sentinel = join(privateDirectory, 'sentinel');
        await writeFile(sentinel, 'must not be exported');
        const lines = [
            { type: 'session_meta', payload: { cwd: '/' } },
            {
                type: 'response_item', timestamp: '2026-09-01T00:00:00.000Z',
                payload: {
                    id: 'message-1', type: 'message', role: 'user', content: [
                        { type: 'input_text', text: 'Export this attachment.' },
                        { type: 'input_image', path: sentinel },
                    ],
                },
            },
        ];
        await writeFile(transcript, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

        const converted = await codexAdapter.convert({ provider: 'codex', path: transcript });

        expect(converted.attachments).toEqual([]);
        expect(converted.unresolvedAttachments).toEqual(['message-1:image:1']);
        expect(JSON.stringify(converted.snapshot)).not.toContain('sentinel');
    });

    it('removes synthetic configuration from mixed content without discarding the attachment', async () => {
        const directory = await createTemporaryDirectory('paws-share-codex-mixed-envelope-');
        temporaryDirectories.push(directory);
        const transcript = join(directory, 'session.jsonl');
        const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
        const lines = [{
            type: 'response_item', timestamp: '2026-09-01T00:00:00.000Z',
            payload: {
                id: 'message-1', type: 'message', role: 'user', content: [
                    { type: 'input_text', text: '<environment_context>private host settings</environment_context>' },
                    { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}` },
                ],
            },
        }];
        await writeFile(transcript, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

        const converted = await codexAdapter.convert({ provider: 'codex', path: transcript });
        const serialized = JSON.stringify(converted.snapshot);

        expect(converted.attachments).toHaveLength(1);
        expect(converted.snapshot.messages).toHaveLength(1);
        expect(converted.snapshot.messages[0].blocks).toEqual([
            expect.objectContaining({ type: 'attachment', kind: 'image' }),
        ]);
        expect(converted.snapshot.title).toBe('Shared coding session');
        expect(serialized).not.toContain('environment_context');
        expect(serialized).not.toContain('private host settings');
    });

    it('converts Happy local-file notices into attachments without exposing local paths', async () => {
        const directory = await createTemporaryDirectory('paws-share-codex-media-');
        temporaryDirectories.push(directory);
        const sessionDirectory = join(directory, 'sessions');
        const attachmentDirectory = join(directory, '.happy', 'attachments');
        await mkdir(sessionDirectory);
        await mkdir(attachmentDirectory, { recursive: true });
        const transcript = join(sessionDirectory, 'session.jsonl');
        const audioPath = join(attachmentDirectory, 'voice.mp3');
        const documentPath = join(attachmentDirectory, 'plan.pdf');
        await writeFile(audioPath, Buffer.from('audio'));
        await writeFile(documentPath, Buffer.from('%PDF'));
        const notice = [
            'Happy attached 2 user-uploaded local files to this turn:',
            `- Audio 1: ${audioPath} (audio/mpeg, 5B)`,
            `- File 2: ${documentPath} (application/pdf, 4B)`,
            'Use the exact local file path above to read or process the PDF according to the user request.',
            'Audio/video content is available at the exact paths above; use command-line tools such as ffmpeg or whisper when needed.',
            'Do not scan ~/.happy/attachments or guess which file the user intended.',
            '',
            'Summarize both attachments.',
        ].join('\n');
        await writeFile(transcript, `${JSON.stringify({
            type: 'response_item', timestamp: '2026-09-01T00:00:00.000Z',
            payload: { id: 'message-1', type: 'message', role: 'user', content: [{ type: 'input_text', text: notice }] },
        })}\n`);

        const converted = await codexAdapter.convert({
            provider: 'codex',
            path: transcript,
            attachmentRoots: [attachmentDirectory],
        });
        const serialized = JSON.stringify(converted.snapshot);

        expect(converted.attachments).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'voice.mp3', kind: 'audio', mimeType: 'audio/mpeg' }),
            expect.objectContaining({ name: 'plan.pdf', kind: 'file', mimeType: 'application/pdf' }),
        ]));
        expect(converted.unresolvedAttachments).toEqual([]);
        expect(serialized).toContain('Summarize both attachments.');
        expect(serialized).not.toContain(attachmentDirectory);
        expect(serialized).not.toContain('Happy attached');
    });

    it('removes Paws host envelopes and synthetic configuration from public content', async () => {
        const directory = await createTemporaryDirectory('paws-share-codex-envelope-');
        temporaryDirectories.push(directory);
        const transcript = join(directory, 'session.jsonl');
        const lines = [
            {
                type: 'response_item', timestamp: '2026-09-01T00:00:00.000Z',
                payload: {
                    type: 'message', role: 'user', content: [
                        { type: 'input_text', text: '<recommended_plugins>private routing</recommended_plugins>' },
                        { type: 'input_text', text: '# AGENTS.md instructions\n<INSTRUCTIONS>private rules</INSTRUCTIONS>' },
                        { type: 'input_text', text: '<environment_context>private environment</environment_context>' },
                    ],
                },
            },
            {
                type: 'response_item', timestamp: '2026-09-01T00:00:01.000Z',
                payload: {
                    id: 'message-1', type: 'message', role: 'user', content: [{
                        type: 'input_text',
                        text: [
                            '<image name=[Image #1] path="/Users/example/private.png">',
                            '</image>',
                            'Happy attached 1 user-uploaded image to this Codex turn.',
                            'Use this exact localImage path.',
                            '- Image 1: /Users/example/private.png',
                            '<!-- happy:paws-origin:private-origin -->',
                            '<!-- happy:system-prompt:start -->',
                            'private runtime settings',
                            '<!-- happy:system-prompt:end -->',
                            '',
                            'Share this session.',
                            '',
                            '<!-- happy:system-prompt:start -->',
                            'more private runtime settings',
                            '<!-- happy:system-prompt:end -->',
                        ].join('\n'),
                    }],
                },
            },
        ];
        await writeFile(transcript, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

        const converted = await codexAdapter.convert({ provider: 'codex', path: transcript });
        const serialized = JSON.stringify(converted.snapshot);

        expect(converted.snapshot.title).toBe('Share this session.');
        expect(converted.snapshot.messages).toHaveLength(1);
        expect(converted.snapshot.messages[0].blocks).toEqual([{ type: 'text', markdown: 'Share this session.' }]);
        expect(serialized).not.toContain('recommended_plugins');
        expect(serialized).not.toContain('private.png');
        expect(serialized).not.toContain('system-prompt');
        expect(serialized).not.toContain('private runtime settings');
    });
});
