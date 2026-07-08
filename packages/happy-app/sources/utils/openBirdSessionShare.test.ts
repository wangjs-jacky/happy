import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import type { Message } from '@/sync/typesMessage';
import { buildOpenBirdSessionMarkdown, publishOpenBirdTempPage } from './openBirdSessionShare';

const session = {
    id: 'session-1',
    seq: 1,
    createdAt: Date.parse('2026-01-01T10:00:00.000Z'),
    updatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
    active: false,
    activeAt: Date.parse('2026-01-01T10:05:00.000Z'),
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 1,
    thinking: false,
    thinkingAt: 0,
    presence: Date.parse('2026-01-01T10:05:00.000Z'),
    metadata: {
        path: '/Users/jacky/project',
        host: 'mac-mini',
        flavor: 'codex',
        summary: {
            text: 'OpenBird Share Session',
            updatedAt: Date.parse('2026-01-01T10:05:00.000Z'),
        },
    },
} satisfies Session;

describe('buildOpenBirdSessionMarkdown', () => {
    it('exports visible user and assistant messages without thinking blocks', () => {
        const messages: Message[] = [
            {
                kind: 'agent-text',
                id: 'thinking',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:02:00.000Z'),
                text: 'private chain of thought',
                isThinking: true,
            },
            {
                kind: 'agent-text',
                id: 'assistant',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:01:00.000Z'),
                text: 'Assistant response.',
            },
            {
                kind: 'user-text',
                id: 'user',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:00:00.000Z'),
                text: 'raw command text',
                displayText: 'Displayed user text',
            },
        ];

        const markdown = buildOpenBirdSessionMarkdown(session, messages, {
            sharedAt: Date.parse('2026-01-02T00:00:00.000Z'),
        });

        expect(markdown).toContain('# OpenBird Share Session');
        expect(markdown).toContain('<style>');
        expect(markdown).toContain('<span>Session ID</span><strong>session-1</strong>');
        expect(markdown).toContain('<span>Host</span><strong>mac-mini</strong>');
        expect(markdown).toContain('<span>Path</span><strong>/Users/jacky/project</strong>');
        expect(markdown).toContain('<span>Agent</span><strong>codex</strong>');
        expect(markdown).toContain('Shared from Happy on 2026-01-02T00:00:00.000Z.');
        expect(markdown.indexOf('Displayed user text')).toBeLessThan(markdown.indexOf('Assistant response.'));
        expect(markdown).not.toContain('raw command text');
        expect(markdown).not.toContain('private chain of thought');
    });

    it('exports tool calls with input, result, and child messages', () => {
        const messages: Message[] = [
            {
                kind: 'tool-call',
                id: 'tool',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:00:00.000Z'),
                tool: {
                    name: 'Bash',
                    state: 'completed',
                    input: { command: 'pnpm test' },
                    createdAt: Date.parse('2026-01-01T10:00:00.000Z'),
                    startedAt: Date.parse('2026-01-01T10:00:00.000Z'),
                    completedAt: Date.parse('2026-01-01T10:00:01.000Z'),
                    description: 'Run tests',
                    result: { output: 'passed' },
                },
                children: [
                    {
                        kind: 'agent-text',
                        id: 'child',
                        localId: null,
                        createdAt: Date.parse('2026-01-01T10:00:02.000Z'),
                        text: 'Tests passed.',
                    },
                ],
            },
        ];

        const markdown = buildOpenBirdSessionMarkdown(session, messages);

        expect(markdown).toContain('<details class="happy-tool-group">');
        expect(markdown).toContain('<span class="happy-tool-name">Bash</span>');
        expect(markdown).toContain('<span class="happy-tool-state">completed</span>');
        expect(markdown).toContain('Run tests');
        expect(markdown).toContain('&quot;command&quot;: &quot;pnpm test&quot;');
        expect(markdown).toContain('&quot;output&quot;: &quot;passed&quot;');
        expect(markdown).toContain('Tests passed.');
    });

    it('renders file image attachments as a gallery instead of collapsed tool JSON', () => {
        const messages: Message[] = [
            {
                kind: 'tool-call',
                id: 'image-1',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:00:00.000Z'),
                tool: {
                    name: 'file',
                    state: 'completed',
                    input: {
                        ref: 'sessions/session-1/attachments/image-one.enc',
                        name: 'image-one.png',
                        size: 123456,
                        image: {
                            width: 900,
                            height: 1200,
                            thumbhash: 'thumb-a',
                        },
                    },
                    createdAt: Date.parse('2026-01-01T10:00:00.000Z'),
                    startedAt: Date.parse('2026-01-01T10:00:00.000Z'),
                    completedAt: Date.parse('2026-01-01T10:00:01.000Z'),
                    description: null,
                },
                children: [],
            },
            {
                kind: 'tool-call',
                id: 'image-2',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:00:02.000Z'),
                tool: {
                    name: 'file',
                    state: 'completed',
                    input: {
                        ref: 'sessions/session-1/attachments/image-two.enc',
                        name: 'image-two.jpg',
                        size: 654321,
                        image: {
                            width: 1200,
                            height: 800,
                        },
                    },
                    createdAt: Date.parse('2026-01-01T10:00:02.000Z'),
                    startedAt: Date.parse('2026-01-01T10:00:02.000Z'),
                    completedAt: Date.parse('2026-01-01T10:00:03.000Z'),
                    description: null,
                },
                children: [],
            },
            {
                kind: 'user-text',
                id: 'user',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:00:04.000Z'),
                text: '帮我处理这些图片',
            },
        ];

        const markdown = buildOpenBirdSessionMarkdown(session, messages);

        expect(markdown).toContain('<div class="happy-image-gallery happy-image-gallery-compact"');
        expect(markdown).toContain('aria-label="Shared images"');
        expect(markdown).toContain('image-one.png');
        expect(markdown).toContain('image-two.jpg');
        expect(markdown).toContain('900 x 1200');
        expect(markdown).toContain('1200 x 800');
        expect(markdown).toContain('帮我处理这些图片');
        expect(markdown).not.toContain('<span class="happy-tool-name">file</span>');
        expect(markdown).not.toContain('&quot;ref&quot;: &quot;sessions/session-1/attachments/image-one.enc&quot;');
    });

    it('renders public or inlined attachment URLs as real images', () => {
        const messages: Message[] = [
            {
                kind: 'tool-call',
                id: 'image-1',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:00:00.000Z'),
                tool: {
                    name: 'file',
                    state: 'completed',
                    input: {
                        ref: 'sessions/session-1/attachments/image-one.enc',
                        name: 'image-one.png',
                        size: 123456,
                        image: {
                            width: 900,
                            height: 1200,
                        },
                    },
                    createdAt: Date.parse('2026-01-01T10:00:00.000Z'),
                    startedAt: Date.parse('2026-01-01T10:00:00.000Z'),
                    completedAt: Date.parse('2026-01-01T10:00:01.000Z'),
                    description: null,
                },
                children: [],
            },
        ];

        const markdown = buildOpenBirdSessionMarkdown(session, messages, {
            attachmentUrls: {
                'sessions/session-1/attachments/image-one.enc': 'data:image/jpeg;base64,abc123',
            },
        });

        expect(markdown).toContain('<img src="data:image/jpeg;base64,abc123" alt="image-one.png" loading="lazy">');
        expect(markdown).not.toContain('<div class="happy-image-placeholder">');
    });

    it('renders Happy options blocks and common Markdown structure as readable HTML', () => {
        const messages: Message[] = [
            {
                kind: 'agent-text',
                id: 'assistant-options',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:01:00.000Z'),
                text: [
                    '## 推荐复用方式',
                    '',
                    '- `createInputStream()`',
                    '- `makeUserMessage()`',
                    '- `mapSdkMessage()` 的文本/thinking/result 部分',
                    '',
                    '<options>',
                    '<option>帮我把 PR #121 合到 jacky-main</option>',
                    '<option>继续只排查入口，不改代码</option>',
                    '</options>',
                ].join('\n'),
            },
        ];

        const markdown = buildOpenBirdSessionMarkdown(session, messages);

        expect(markdown).toContain('<h3 class="happy-inline-heading happy-inline-heading-2">推荐复用方式</h3>');
        expect(markdown).toContain('<ul class="happy-list"><li><code>createInputStream()</code></li><li><code>makeUserMessage()</code></li>');
        expect(markdown).toContain('<div class="happy-options" role="group" aria-label="Options">');
        expect(markdown).toContain('<div class="happy-option">帮我把 PR #121 合到 jacky-main</div>');
        expect(markdown).toContain('<div class="happy-option">继续只排查入口，不改代码</div>');
        expect(markdown).not.toContain('<options>');
        expect(markdown).not.toContain('<option>');
    });

    it('renders GPT image prompts and style options as app-like share controls', () => {
        const messages: Message[] = [
            {
                kind: 'user-text',
                id: 'user-gpt-image',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:01:00.000Z'),
                text: [
                    '使用 $gpt-image-2 skill 执行一次 GPT Image 2 图片编辑 / 生成批处理。',
                    '',
                    '生成锁：',
                    '- 将这次请求视为一个已锁定的图片生成任务。',
                    '- 不要启动第二个批处理。',
                    '',
                    '推荐续生成选项：',
                    '<options>',
                    '<option>[[gpt-image-style:reference-voxcat/wild-mountain-sketchbook/1]] 山野旅行速写手帐</option>',
                    '<option>[[gpt-image-style:reference-tiramisu/vintage-film-cafe/1]] 复古胶片咖啡馆</option>',
                    '<option>[[gpt-image-style:reference-tiramisu/premium-studio-food/1]] 高级影棚甜点摄影</option>',
                    '</options>',
                ].join('\n'),
            },
        ];

        const markdown = buildOpenBirdSessionMarkdown(session, messages);

        expect(markdown).toContain('<details class="happy-prompt-fold" open>');
        expect(markdown).toContain('提示词已折叠');
        expect(markdown).toContain('<div class="happy-style-options" role="group" aria-label="GPT Image style options">');
        expect(markdown).toContain('<div class="happy-style-option">山野旅行速写手帐</div>');
        expect(markdown).not.toContain('<div class="happy-option">[[gpt-image-style:reference-voxcat/wild-mountain-sketchbook/1]]');
        expect(markdown).not.toContain(':has(');
    });

    it('renders Happy OTA preview metadata as a share card instead of raw tags', () => {
        const messages: Message[] = [
            {
                kind: 'agent-text',
                id: 'assistant-ota',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:01:00.000Z'),
                text: [
                    '已重新发布 preview OTA。',
                    '',
                    '<happy-ota-preview>',
                    'title: OpenBird session sharing preview',
                    'channel: preview',
                    'platform: android',
                    'runtimeVersion: 21',
                    'updateId: 1a23efc8-269a-009f-21fc-17670e886850',
                    'stamp: 1783506479461',
                    'manifestUrl: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/latest.json',
                    'sourceUrl: https://github.com/wangjs-jacky/happy/actions/runs/28935622619',
                    'summary: Preview OTA for PR #165 was published and OSS manifest plus bundle returned 200.',
                    '</happy-ota-preview>',
                ].join('\n'),
            },
        ];

        const markdown = buildOpenBirdSessionMarkdown(session, messages);

        expect(markdown).toContain('<aside class="happy-ota-card" aria-label="Happy OTA preview">');
        expect(markdown).toContain('<h3>OpenBird session sharing preview</h3>');
        expect(markdown).toContain('<span>runtime 21</span>');
        expect(markdown).toContain('<dt>Update ID</dt><dd>1a23efc8-269a-009f-21fc-17670e886850</dd>');
        expect(markdown).toContain('href="https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/latest.json"');
        expect(markdown).not.toContain('<happy-ota-preview>');
        expect(markdown).not.toContain('</happy-ota-preview>');
    });

    it('renders tables, blockquotes, and horizontal rules like a document share', () => {
        const messages: Message[] = [
            {
                kind: 'agent-text',
                id: 'assistant-table',
                localId: null,
                createdAt: Date.parse('2026-01-01T10:01:00.000Z'),
                text: [
                    '核心区别：**七层**看内容，**四层**看地址。',
                    '',
                    '---',
                    '',
                    '| 维度 | 四层 | 七层 |',
                    '| --- | --- | --- |',
                    '| 转发依据 | IP + 端口 | URL、Host、Cookie |',
                    '| 适用场景 | 数据库 | 网站、API |',
                    '',
                    '> 做网站、API → 七层',
                    '> 做数据库、游戏服务器 → 四层',
                ].join('\n'),
            },
        ];

        const markdown = buildOpenBirdSessionMarkdown(session, messages);

        expect(markdown).toContain('<hr class="happy-inline-rule">');
        expect(markdown).toContain('<div class="happy-table-wrap">');
        expect(markdown).toContain('<th>维度</th><th>四层</th><th>七层</th>');
        expect(markdown).toContain('<td>转发依据</td><td>IP + 端口</td><td>URL、Host、Cookie</td>');
        expect(markdown).toContain('<blockquote class="happy-blockquote">');
        expect(markdown).toContain('做网站、API → 七层');
    });
});

describe('publishOpenBirdTempPage', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('posts markdown as an OpenBird guest page', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: true,
                url: 'https://openbird.example/share-slug',
                slug: 'share-slug',
                expiresAt: '2026-01-01T11:00:00.000Z',
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await publishOpenBirdTempPage('# Hello', {
            apiBaseUrl: 'https://openbird.example/',
        });

        expect(fetchMock).toHaveBeenCalledWith('https://openbird.example/api/v1/publish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ markdown: '# Hello', temp: true }),
        });
        expect(result).toEqual({
            url: 'https://openbird.example/share-slug',
            slug: 'share-slug',
            expiresAt: '2026-01-01T11:00:00.000Z',
        });
    });

    it('surfaces OpenBird API errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 413,
            json: async () => ({ error: 'Markdown content too large' }),
        }));

        await expect(publishOpenBirdTempPage('# Hello')).rejects.toThrow('Markdown content too large');
    });
});
