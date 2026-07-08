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

    it('renders GPT image prompts and style options closer to the app transcript', () => {
        const longPrompt = [
            '使用 $gpt-image-2 skill 执行一次 GPT Image 2 图片编辑 / 生成批处理。',
            '',
            '生成锁：',
            '- 将这次请求视为一个已锁定的图片生成任务。',
            '- 在每个选中风格的输出都保存完成之前，不要启动第二个批处理。',
            '',
            '推荐续生成选项：',
            '<options>',
            '<option>[[gpt-image-style:reference-voxcat/wild-mountain-sketchbook/1]] 山野旅行速写手帐</option>',
            '<option>[[gpt-image-style:reference-tiramisu/vintage-film-cafe/1]] 复古胶片咖啡馆</option>',
            '<option>[[gpt-image-style:reference-tiramisu/premium-studio-food/1]] 高级影棚甜点摄影</option>',
            '</options>',
        ].join('\n');

        const html = buildHappySessionShareHtml(session, [{
            kind: 'user-text',
            id: 'user-prompt',
            localId: null,
            createdAt: 1,
            text: longPrompt,
        }]);

        expect(html).toContain('<details class="prompt-fold" open>');
        expect(html).toContain('提示词已折叠');
        expect(html).toContain('<div class="style-options" role="group" aria-label="GPT Image style options">');
        expect(html).toContain('<div class="style-option">山野旅行速写手帐</div>');
        expect(html).not.toContain('<span>[[gpt-image-style:reference-voxcat/wild-mountain-sketchbook/1]]');
    });
});
