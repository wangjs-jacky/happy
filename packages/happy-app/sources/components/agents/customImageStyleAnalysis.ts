import * as z from 'zod';

export const CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_START = 'CUSTOM_IMAGE_STYLE_PROMPT_JSON_START';
export const CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_END = 'CUSTOM_IMAGE_STYLE_PROMPT_JSON_END';

const StylePromptExtractionSchema = z.object({
    promptContent: z.string().min(40),
    negativePrompt: z.string().optional().default(''),
    tags: z.array(z.string()).default([]),
    summary: z.string().optional().default(''),
});

export type StylePromptExtraction = z.infer<typeof StylePromptExtractionSchema>;

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

export function parseStylePromptExtractionFromMessage(text: string): StylePromptExtraction | null {
    const candidates = [
        extractBetweenMarkers(text),
        text,
        extractFirstJsonObject(text),
    ].filter((item): item is string => !!item?.trim());

    for (const candidate of candidates) {
        try {
            return parseStylePromptExtraction(candidate);
        } catch {
            // Try the next possible JSON segment.
        }
    }
    return null;
}

export function buildCustomImageStyleAnalysisPrompt(title: string) {
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
        '只输出下面两个标记包裹的 JSON，不要 Markdown，不要解释，不要额外文本。',
        CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_START,
        JSON.stringify({
            promptContent: '这里输出中文可复用风格 Prompt，至少 40 字，必须强调保留用户本次主体，只迁移视觉语言',
            negativePrompt: '这里输出反向约束，可为空字符串',
            tags: ['标签1', '标签2', '标签3'],
            summary: '一句话中文风格摘要',
        }, null, 2),
        CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_END,
    ].join('\n');
}

function stripJsonFence(text: string) {
    const trimmed = text.trim();
    const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return match ? match[1] : trimmed;
}

function extractBetweenMarkers(text: string) {
    const start = text.indexOf(CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_START);
    const end = text.indexOf(CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_END);
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start + CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_START.length, end).trim();
}

function extractFirstJsonObject(text: string) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return text.slice(start, end + 1);
}
