import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveStructuredAttachment } from './shared';
import { createTemporaryDirectory, removeTemporaryDirectory } from '../testSupport/temporaryDirectory';

describe('resolveStructuredAttachment', () => {
    const directories: string[] = [];

    afterEach(async () => {
        await Promise.all(directories.splice(0).map(removeTemporaryDirectory));
    });

    it('keeps attachment IDs stable within a session and isolated across sessions', async () => {
        const directory = await createTemporaryDirectory('paws-share-attachment-id-');
        directories.push(directory);
        await writeFile(join(directory, 'shared.png'), Buffer.from('same attachment'));

        const sessionA = { provider: 'codex' as const, path: join(directory, 'session-a.jsonl'), cwd: directory };
        const sessionB = { provider: 'codex' as const, path: join(directory, 'session-b.jsonl'), cwd: directory };
        const first = await resolveStructuredAttachment(sessionA, 'shared.png', directory);
        const repeated = await resolveStructuredAttachment(sessionA, 'shared.png', directory);
        const secondSession = await resolveStructuredAttachment(sessionB, 'shared.png', directory);

        expect(repeated.attachmentId).toBe(first.attachmentId);
        expect(secondSession.attachmentId).not.toBe(first.attachmentId);
    });

    it('rejects a symlink that escapes every allowed attachment root', async () => {
        const directory = await createTemporaryDirectory('paws-share-attachment-root-');
        directories.push(directory);
        const sessionDirectory = join(directory, 'session');
        const outsideDirectory = join(directory, 'outside');
        await mkdir(sessionDirectory);
        await mkdir(outsideDirectory);
        await writeFile(join(outsideDirectory, 'secret.txt'), 'outside secret');
        await symlink(join(outsideDirectory, 'secret.txt'), join(sessionDirectory, 'linked-secret.txt'));
        const candidate = { provider: 'codex' as const, path: join(sessionDirectory, 'session.jsonl'), cwd: sessionDirectory };

        await expect(resolveStructuredAttachment(candidate, 'linked-secret.txt', sessionDirectory))
            .rejects.toThrow('outside the session root');
    });

    it('allows an exact file under a caller-provided Happy attachment root without trusting transcript cwd', async () => {
        const directory = await createTemporaryDirectory('paws-share-happy-root-');
        directories.push(directory);
        const sessionDirectory = join(directory, 'sessions');
        const attachmentDirectory = join(directory, '.happy', 'attachments');
        const privateDirectory = join(directory, 'private');
        await mkdir(sessionDirectory);
        await mkdir(attachmentDirectory, { recursive: true });
        await mkdir(privateDirectory);
        const attachment = join(attachmentDirectory, 'current-upload.png');
        await writeFile(attachment, Buffer.from('happy attachment'));
        await writeFile(join(privateDirectory, 'sentinel.png'), Buffer.from('private file'));
        const candidate = {
            provider: 'codex' as const,
            path: join(sessionDirectory, 'session.jsonl'),
            cwd: '/',
            attachmentRoots: [attachmentDirectory],
        };

        await expect(resolveStructuredAttachment(candidate, attachment, '/')).resolves.toMatchObject({
            name: 'current-upload.png',
            size: 16,
        });
        await expect(resolveStructuredAttachment(candidate, join(privateDirectory, 'sentinel.png'), '/'))
            .rejects.toThrow('outside the session root');
    });
});
