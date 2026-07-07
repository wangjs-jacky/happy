import { describe, expect, it } from 'vitest';
import { IMAGE_AGENT_STYLE_PRESETS } from './imageAgentPrompt';
import {
    buildImageStyleContinuationPrompt,
    formatImageStyleOption,
    parseImageStyleOptions,
} from './imageStyleOptions';

describe('imageStyleOptions', () => {
    it('parses encoded GPT Image Gallery options, removes duplicates, and caps at ten', () => {
        const styles = IMAGE_AGENT_STYLE_PRESETS.slice(0, 12);
        const options = [
            formatImageStyleOption(styles[0]),
            ...styles.map(formatImageStyleOption),
            '普通选项',
        ];

        const parsed = parseImageStyleOptions(options);

        expect(parsed).toHaveLength(10);
        expect(parsed[0]?.style.id).toBe(styles[0].id);
        expect(parsed.map((item) => item.style.id)).toEqual(
            styles.slice(0, 10).map((style) => style.id),
        );
    });

    it('builds one continuation prompt for multiple selected Gallery styles', () => {
        const styles = IMAGE_AGENT_STYLE_PRESETS.slice(0, 3);

        const prompt = buildImageStyleContinuationPrompt(styles, { variantsPerStyle: 3 });

        expect(prompt).toContain('$gpt-image-2');
        expect(prompt).toContain('同一个批处理');
        expect(prompt).toContain('不限制多风格');
        expect(prompt).toContain('各生成 3 张变体');
        expect(prompt).toContain('<options>');
        expect(prompt).toContain('[[gpt-image-style:');
        for (const style of styles) {
            expect(prompt).toContain(style.id);
            expect(prompt).toContain(style.promptHint);
        }
    });
});
