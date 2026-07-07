import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system/legacy', () => ({
    EncodingType: { Base64: 'base64' },
    readAsStringAsync: vi.fn(),
}));

import {
    CUSTOM_IMAGE_STYLE_ANALYSIS_MODEL,
    extractCustomImageStylePrompt,
    imageReferenceToDataUrl,
    parseStylePromptExtraction,
} from './customImageStyleAnalysis';

describe('customImageStyleAnalysis', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('parses strict JSON and strips markdown fences', () => {
        const parsed = parseStylePromptExtraction(`\`\`\`json
{
  "promptContent": "低饱和暖色胶片风格，柔和窗光，轻微颗粒，主体保持用户输入内容，参考图只提供视觉语言。",
  "negativePrompt": "过曝，高锐化",
  "tags": [" 胶片 ", "暖色", ""],
  "summary": "低饱和胶片"
}
\`\`\``);

        expect(parsed).toEqual({
            promptContent: '低饱和暖色胶片风格，柔和窗光，轻微颗粒，主体保持用户输入内容，参考图只提供视觉语言。',
            negativePrompt: '过曝，高锐化',
            tags: ['胶片', '暖色'],
            summary: '低饱和胶片',
        });
    });

    it('keeps existing data URLs without reading local files', async () => {
        await expect(imageReferenceToDataUrl({
            uri: 'data:image/png;base64,abc123',
            mimeType: 'image/png',
        })).resolves.toBe('data:image/png;base64,abc123');
    });

    it('calls OpenAI Responses with image inputs and returns extracted prompt data', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                output_text: JSON.stringify({
                    promptContent: '手绘彩铅漫画风格，纸张颗粒明显，黑色勾线松弛，主体沿用用户输入，不复刻参考图角色。',
                    negativePrompt: '真实摄影，光滑 3D，低清晰度',
                    tags: ['彩铅', '漫画', '纸张纹理'],
                    summary: '手绘彩铅漫画',
                }),
            }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await extractCustomImageStylePrompt({
            apiKey: 'sk-test',
            title: '我的漫画风格',
            images: [{
                id: 'r1',
                uri: 'data:image/jpeg;base64,abc123',
                width: 800,
                height: 1000,
                mimeType: 'image/jpeg',
                size: 123,
                name: 'style.jpg',
            }],
        });

        expect(result.summary).toBe('手绘彩铅漫画');
        expect(result.promptContent).toContain('主体沿用用户输入');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(init.body);
        expect(body.model).toBe(CUSTOM_IMAGE_STYLE_ANALYSIS_MODEL);
        expect(body.input[0].content).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'input_image', image_url: 'data:image/jpeg;base64,abc123', detail: 'high' }),
        ]));
        expect(body.text.format.type).toBe('json_schema');
    });
});
