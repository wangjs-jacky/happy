import { describe, expect, it } from 'vitest';

import {
    CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_END,
    CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_START,
    buildCustomImageStyleAnalysisPrompt,
    parseStylePromptExtraction,
    parseStylePromptExtractionFromMessage,
} from './customImageStyleAnalysis';

describe('customImageStyleAnalysis', () => {
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

    it('builds a Codex extraction prompt with strict JSON markers', () => {
        const prompt = buildCustomImageStyleAnalysisPrompt('我的漫画风格');
        expect(prompt).toContain('我的漫画风格');
        expect(prompt).toContain(CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_START);
        expect(prompt).toContain(CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_END);
        expect(prompt).toContain('保留用户本次主体');
    });

    it('extracts Prompt JSON from a Codex message with marker text', () => {
        const result = parseStylePromptExtractionFromMessage(`
我已完成提炼。
${CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_START}
{
  "promptContent": "手绘彩铅漫画风格，纸张颗粒明显，黑色勾线松弛，主体沿用用户输入，不复刻参考图角色。",
  "negativePrompt": "真实摄影，光滑 3D，低清晰度",
  "tags": ["彩铅", "漫画", "纸张纹理"],
  "summary": "手绘彩铅漫画"
}
${CUSTOM_IMAGE_STYLE_ANALYSIS_RESULT_END}
`);

        expect(result?.summary).toBe('手绘彩铅漫画');
        expect(result?.promptContent).toContain('主体沿用用户输入');
    });
});
