import { describe, expect, it } from 'vitest';
import { FOLD_PROMPT_CLOSE_TAG, FOLD_PROMPT_OPEN_TAG, getAutoFoldPromptInfo } from './autoFoldPrompt';

describe('getAutoFoldPromptInfo', () => {
    it('folds explicitly tagged prompt dumps', () => {
        const text = [
            'Here is the prompt I used:',
            FOLD_PROMPT_OPEN_TAG,
            'Create a cinematic portrait with soft window light and a consistent ink-wash texture.',
            ...Array.from({ length: 28 }, (_, index) => `Prompt detail ${index}: preserve brush texture, paper grain, restrained contrast, imperfect ink edges, and the same quiet gallery composition.`),
            FOLD_PROMPT_CLOSE_TAG,
        ].join('\n');

        const info = getAutoFoldPromptInfo(text);

        expect(info).not.toBeNull();
        expect(info?.lineCount).toBeGreaterThan(10);
        expect(info?.content).toContain('cinematic portrait');
        expect(info?.preview).toContain('cinematic portrait');
    });

    it('does not fold untagged long Chinese prompt dumps', () => {
        const text = [
            '风格提示词：',
            '保持水墨纸张肌理、粗粝笔触、低饱和色彩与留白构图。',
            ...Array.from({ length: 32 }, (_, index) => `第 ${index} 条：画面需要延续书法笔势、宣纸纹理、印章式红色点缀、自然阴影和克制的构图节奏。`),
        ].join('\n');

        expect(getAutoFoldPromptInfo(text)).toBeNull();
    });

    it('does not fold long prose without explicit tags', () => {
        const text = Array.from({ length: 30 }, (_, index) => `This is a detailed implementation note line ${index} with normal explanatory content.`).join('\n');

        expect(getAutoFoldPromptInfo(text)).toBeNull();
    });

    it('ignores empty tagged content', () => {
        expect(getAutoFoldPromptInfo(`${FOLD_PROMPT_OPEN_TAG}\n\n${FOLD_PROMPT_CLOSE_TAG}`)).toBeNull();
    });
});
