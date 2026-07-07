import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@/sync/typesMessage';
import { collectOpenBirdImageAttachments, prepareOpenBirdAttachmentUrls } from './openBirdShareAssets';

function imageMessage(id: string, ref: string, createdAt: number): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt,
        tool: {
            name: 'file',
            state: 'completed',
            input: {
                ref,
                name: `${id}.png`,
                size: 120_000,
                image: {
                    width: 900,
                    height: 1200,
                },
            },
            createdAt,
            startedAt: createdAt,
            completedAt: createdAt + 1,
            description: null,
        },
        children: [],
    };
}

describe('openBirdShareAssets', () => {
    it('collects unique image file attachments in chronological order', () => {
        const messages: Message[] = [
            imageMessage('second', 'ref-2', 2),
            imageMessage('first', 'ref-1', 1),
            imageMessage('duplicate', 'ref-1', 3),
            {
                kind: 'tool-call',
                id: 'bash',
                localId: null,
                createdAt: 4,
                tool: {
                    name: 'Bash',
                    state: 'completed',
                    input: { command: 'pnpm test' },
                    createdAt: 4,
                    startedAt: 4,
                    completedAt: 5,
                    description: null,
                },
                children: [],
            },
        ];

        expect(collectOpenBirdImageAttachments(messages).map((item) => item.ref)).toEqual(['ref-1', 'ref-2']);
    });

    it('loads attachment data URIs without exceeding the publish budget', async () => {
        const loader = vi.fn(async (attachment: { ref: string }) => (
            attachment.ref === 'ref-2'
                ? `data:image/jpeg;base64,${'b'.repeat(80)}`
                : `data:image/jpeg;base64,${'a'.repeat(20)}`
        ));

        const urls = await prepareOpenBirdAttachmentUrls('session-1', [
            imageMessage('first', 'ref-1', 1),
            imageMessage('second', 'ref-2', 2),
        ], {
            maxTotalDataUriLength: 60,
            dataUriLoader: loader,
        });

        expect(urls).toEqual({
            'ref-1': `data:image/jpeg;base64,${'a'.repeat(20)}`,
        });
        expect(loader).toHaveBeenCalledTimes(2);
    });

    it('continues when one attachment cannot be prepared', async () => {
        const urls = await prepareOpenBirdAttachmentUrls('session-1', [
            imageMessage('first', 'ref-1', 1),
            imageMessage('second', 'ref-2', 2),
        ], {
            dataUriLoader: async (attachment) => {
                if (attachment.ref === 'ref-1') {
                    throw new Error('decrypt failed');
                }
                return 'data:image/jpeg;base64,ok';
            },
        });

        expect(urls).toEqual({
            'ref-2': 'data:image/jpeg;base64,ok',
        });
    });
});
