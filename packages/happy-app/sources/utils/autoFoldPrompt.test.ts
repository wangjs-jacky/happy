import { describe, expect, it } from 'vitest';
import { getAutoFoldPromptBodyRenderState, getAutoFoldPromptInfo } from './autoFoldPrompt';

describe('getAutoFoldPromptInfo', () => {
    it('folds long image style prompt dumps', () => {
        const text = [
            'Style prompt:',
            'Create a cinematic portrait with soft window light and a consistent ink-wash texture.',
            ...Array.from({ length: 28 }, (_, index) => `Prompt detail ${index}: preserve brush texture, paper grain, restrained contrast, imperfect ink edges, and the same quiet gallery composition.`),
        ].join('\n');

        const info = getAutoFoldPromptInfo(text);

        expect(info).not.toBeNull();
        expect(info?.lineCount).toBeGreaterThan(10);
        expect(info?.preview).toContain('Style prompt:');
    });

    it('folds long Chinese prompt dumps', () => {
        const text = [
            '风格提示词：',
            '保持水墨纸张肌理、粗粝笔触、低饱和色彩与留白构图。',
            ...Array.from({ length: 32 }, (_, index) => `第 ${index} 条：画面需要延续书法笔势、宣纸纹理、印章式红色点缀、自然阴影和克制的构图节奏。`),
        ].join('\n');

        expect(getAutoFoldPromptInfo(text)).not.toBeNull();
    });

    it('folds generated GPT Image 2 batch task prompts even when they are short', () => {
        const text = [
            '使用 $gpt-image-2 skill 执行一次 GPT Image 2 图片编辑 / 生成批处理。',
            '',
            '生成锁：',
            '- 将这次请求视为一个已锁定的图片生成任务。',
            '',
            '输入：已上传 1 张参考图。',
            '用户目标：做成漫画风格头像。',
            '',
            '输出要求：',
            '- 对下面每个选中的风格，各生成 1 张变体。',
            '- 每保存一张 PNG/JPEG 后，立即用绝对本地路径调用 mcp__happy__send_image 内联发送。',
        ].join('\n');

        const info = getAutoFoldPromptInfo(text);

        expect(info).not.toBeNull();
        expect(info?.preview).toContain('$gpt-image-2');
    });

    it('uses markdown rendering when a folded prompt is expanded so embedded options stay interactive', () => {
        const text = [
            '使用 $gpt-image-2 skill 执行一次 GPT Image 2 图片编辑 / 生成批处理。',
            '',
            '生成锁：',
            '- 将这次请求视为一个已锁定的图片生成任务。',
            '',
            '输入：已上传 1 张参考图。',
            '用户目标：做成复古胶片咖啡馆。',
            '',
            '输出要求：',
            '- 每保存一张 PNG/JPEG 后，立即用绝对本地路径调用 mcp__happy__send_image 内联发送。',
            '',
            '推荐续生成选项：',
            '<options>',
            '<option>[[gpt-image-style:reference-tiramisu/vintage-film-cafe/1]] 复古胶片咖啡馆</option>',
            '<option>[[gpt-image-style:reference-tiramisu/white-product/1]] 白底电商主图</option>',
            '</options>',
        ].join('\n');
        const info = getAutoFoldPromptInfo(text);

        if (!info) throw new Error('expected prompt to fold');

        expect(getAutoFoldPromptBodyRenderState({ text, info, expanded: false })).toEqual({
            kind: 'preview-text',
            text: info.preview,
        });
        expect(getAutoFoldPromptBodyRenderState({ text, info, expanded: true })).toEqual({
            kind: 'markdown',
            text,
            markdownVariant: 'foldedPrompt',
        });
    });

    it('does not fold long prose without prompt markers', () => {
        const text = Array.from({ length: 30 }, (_, index) => `This is a detailed implementation note line ${index} with normal explanatory content.`).join('\n');

        expect(getAutoFoldPromptInfo(text)).toBeNull();
    });

    it('does not fold short prompt mentions', () => {
        expect(getAutoFoldPromptInfo('The prompt should mention the subject clearly.')).toBeNull();
    });
});
