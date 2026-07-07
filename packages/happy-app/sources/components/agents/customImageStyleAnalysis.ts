import * as z from 'zod';
import { encodeBase64 } from '@/encryption/base64';
import { readFileBytes } from '@/utils/readFileBytes';
import type { ImageAgentStyleReferenceImage } from './imageStyleTypes';

export const CUSTOM_IMAGE_STYLE_ANALYSIS_MODEL = 'gpt-4.1-mini';

const StylePromptExtractionSchema = z.object({
    promptContent: z.string().min(40),
    negativePrompt: z.string().optional().default(''),
    tags: z.array(z.string()).default([]),
    summary: z.string().optional().default(''),
});

export type StylePromptExtraction = z.infer<typeof StylePromptExtractionSchema>;

export async function imageReferenceToDataUrl(image: Pick<ImageAgentStyleReferenceImage, 'uri' | 'mimeType'>): Promise<string> {
    if (image.uri.startsWith('data:')) {
        return image.uri;
    }

    const bytes = await readFileBytes(image.uri);
    return `data:${normalizeImageMimeType(image.mimeType)};base64,${encodeBase64(bytes)}`;
}

export async function extractCustomImageStylePrompt(args: {
    apiKey: string;
    title: string;
    images: ImageAgentStyleReferenceImage[];
    signal?: AbortSignal;
}): Promise<StylePromptExtraction> {
    const apiKey = args.apiKey.trim();
    if (!apiKey) {
        throw new Error('OpenAI API key is required');
    }
    if (args.images.length === 0) {
        throw new Error('At least one reference image is required');
    }

    const imageInputs = await Promise.all(args.images.slice(0, 6).map(async (image) => ({
        type: 'input_image',
        image_url: await imageReferenceToDataUrl(image),
        detail: 'high',
    })));

    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: args.signal,
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: CUSTOM_IMAGE_STYLE_ANALYSIS_MODEL,
            input: [{
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: buildStyleExtractionInstruction(args.title),
                    },
                    ...imageInputs,
                ],
            }],
            text: {
                format: {
                    type: 'json_schema',
                    name: 'custom_image_style_prompt',
                    strict: true,
                    schema: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['promptContent', 'negativePrompt', 'tags', 'summary'],
                        properties: {
                            promptContent: {
                                type: 'string',
                                description: 'Reusable Chinese GPT Image style prompt extracted from the reference images.',
                            },
                            negativePrompt: {
                                type: 'string',
                                description: 'Visual traits to avoid when applying this style.',
                            },
                            tags: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '3-8 concise Chinese style tags.',
                            },
                            summary: {
                                type: 'string',
                                description: 'One short Chinese summary for UI display.',
                            },
                        },
                    },
                },
            },
        }),
    });

    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
        throw new Error(readOpenAIError(payload) ?? `OpenAI request failed with ${response.status}`);
    }

    return parseStylePromptExtraction(extractResponseText(payload));
}

export function parseStylePromptExtraction(rawText: string): StylePromptExtraction {
    const jsonText = stripJsonFence(rawText).trim();
    const parsed = JSON.parse(jsonText);
    const result = StylePromptExtractionSchema.parse(parsed);
    return {
        promptContent: result.promptContent.trim(),
        negativePrompt: result.negativePrompt.trim(),
        tags: result.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
        summary: result.summary.trim(),
    };
}

function buildStyleExtractionInstruction(title: string) {
    return [
        `请从这些参考图中提炼一个可长期复用的 GPT Image 2 风格 Prompt。风格名：${title}`,
        '',
        '目标：沉淀风格，不复刻参考图主体。下次用户上传任意主体或描述时，应该能直接使用 promptContent 迁移视觉语言。',
        '',
        'promptContent 必须用中文，结构清晰但不要过长，覆盖：',
        '- 媒介/画面类型、质感、笔触或镜头语言',
        '- 色彩系统、对比度、颗粒/噪点、材质',
        '- 光线、景深、构图、主体与背景关系',
        '- 版式/文字/装饰元素倾向（如果参考图里明显存在）',
        '- 使用规则：保留用户本次主体，不把参考图主体当成必须复刻内容',
        '',
        'negativePrompt 写不适合该风格的元素，例如过度写实、错误材质、主体跑偏、低清晰度等。',
        'tags 给 3-8 个中文短标签。',
        '只输出 JSON。不要 Markdown，不要解释。',
    ].join('\n');
}

function normalizeImageMimeType(mimeType: string | undefined) {
    const value = mimeType?.toLowerCase().trim();
    if (value === 'image/png' || value === 'image/webp' || value === 'image/gif') {
        return value;
    }
    return 'image/jpeg';
}

function stripJsonFence(text: string) {
    const trimmed = text.trim();
    const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return match ? match[1] : trimmed;
}

function extractResponseText(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const record = payload as Record<string, unknown>;
    if (typeof record.output_text === 'string') {
        return record.output_text;
    }

    const output = record.output;
    if (!Array.isArray(output)) return '';
    const chunks: string[] = [];
    for (const item of output) {
        if (!item || typeof item !== 'object') continue;
        const content = (item as Record<string, unknown>).content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
            if (!part || typeof part !== 'object') continue;
            const partRecord = part as Record<string, unknown>;
            if (typeof partRecord.text === 'string') chunks.push(partRecord.text);
        }
    }
    return chunks.join('\n');
}

function readOpenAIError(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const error = (payload as Record<string, unknown>).error;
    if (!error || typeof error !== 'object') return undefined;
    const message = (error as Record<string, unknown>).message;
    return typeof message === 'string' ? message : undefined;
}
