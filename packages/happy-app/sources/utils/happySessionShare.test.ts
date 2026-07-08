import { describe, expect, it } from 'vitest';
import { buildHappySessionShareHtml } from './happySessionShare';
import type { Session } from '@/sync/storageTypes';
import type { Message } from '@/sync/typesMessage';

const session = {
    id: 'session-1',
    metadata: {
        summary: { text: 'Share test' },
    },
} as unknown as Session;

describe('buildHappySessionShareHtml', () => {
    it('renders options as Happy controls and image attachments as public URLs', () => {
        const messages: Message[] = [
            {
                kind: 'agent-text',
                id: 'assistant-options',
                localId: null,
                createdAt: 1,
                text: [
                    'Pick one:',
                    '',
                    '<options>',
                    '<option>继续 review 165</option>',
                    '<option>处理下一个 PR</option>',
                    '</options>',
                ].join('\n'),
            },
            {
                kind: 'tool-call',
                id: 'image-tool',
                localId: null,
                createdAt: 2,
                tool: {
                    name: 'file',
                    state: 'completed',
                    input: {
                        ref: 'img-ref',
                        name: 'preview.jpg',
                        size: 1200,
                        image: { width: 640, height: 480 },
                    },
                    createdAt: 2,
                    startedAt: 2,
                    completedAt: 2,
                    description: null,
                },
                children: [],
            },
        ];

        const html = buildHappySessionShareHtml(session, messages, {
            attachmentUrls: { 'img-ref': 'https://example.com/preview.jpg' },
        });

        expect(html).toContain('<div class="happy-options" role="group" aria-label="Options">');
        expect(html).toContain('<span>继续 review 165</span>');
        expect(html).toContain('<img src="https://example.com/preview.jpg"');
        expect(html).not.toContain('<options>');
        expect(html).not.toContain('<option>');
    });
});
