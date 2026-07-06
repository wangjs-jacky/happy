import { describe, expect, it } from 'vitest';
import {
    IMAGE_AGENT_STYLE_PRESETS,
    buildImageAgentPrompt,
    getImageAgentStylesForAgent,
} from './imageAgentPrompt';
import { createImageStyleSelectionPrompt } from './imageAgentMode';
import type { AgentLauncher } from './launchAgent';

const agent: AgentLauncher = {
    id: 'img1',
    name: 'Tiramisu Lab',
    glyph: 'T',
    color: '#8B5E3C',
    machineId: 'm1',
    path: '~/work',
    kind: 'image-styles',
    imageStyleIds: ['premium-studio', 'white-product'],
    imageVariantsPerStyle: 2,
    presets: [],
};

describe('imageAgentPrompt', () => {
    it('resolves legacy GPT Image 2 style ids to Garden case styles for saved agents', () => {
        const styles = getImageAgentStylesForAgent(agent);

        expect(styles).toHaveLength(2);
        expect(styles[0].templateRef).toBe('product-visuals/premium-studio-product.md');
        expect(styles[1].templateRef).toBe('product-visuals/white-background-product.md');
        expect(styles.map((style) => style.promptContent ?? '').every((prompt) => prompt.length > 200)).toBe(true);
    });

    it('builds a composer prompt from the selected Garden case prompt', () => {
        const style = IMAGE_AGENT_STYLE_PRESETS.find((preset) => preset.id === 'product-visuals/white-background-product/1');
        expect(style).toBeTruthy();

        const prompt = createImageStyleSelectionPrompt(style!);

        expect(prompt).toContain('使用 $gpt-image-2 skill');
        expect(prompt).toContain('已选择的 Garden 案例：product-visuals/white-background-product/1');
        expect(prompt).toContain(style!.promptContent.slice(0, 120));
    });

    it('includes local OBA article styles in the image style gallery catalog', () => {
        const tiramisuStyle = IMAGE_AGENT_STYLE_PRESETS.find((preset) => preset.id === 'oba-tiramisu/vintage-film-cafe/1');
        const dogStyle = IMAGE_AGENT_STYLE_PRESETS.find((preset) => preset.id === 'oba-dog/healing-watercolor/1');

        expect(tiramisuStyle?.sourceRepository).toBe('local-obsidian-oba');
        expect(tiramisuStyle?.promptPath).toContain('tiramisu-vintage-film-cafe');
        expect(tiramisuStyle?.promptContent).toContain('nostalgic 35mm film');
        expect(dogStyle?.sourceRepository).toBe('local-obsidian-oba');
        expect(dogStyle?.promptPath).toContain('dog-healing-watercolor');
        expect(dogStyle?.promptContent).toContain('cream-colored curly dog');
    });

    it('builds a locked multi-image GPT Image 2 batch prompt', () => {
        const prompt = buildImageAgentPrompt({
            agent,
            userPrompt: 'Use the dairy reference photo and keep the plate shape.',
            imageCount: 3,
        });

        expect(prompt).toContain('$gpt-image-2');
        expect(prompt).toContain('生成锁');
        expect(prompt).toContain('已上传 3 张参考图');
        expect(prompt).toContain('product-visuals/premium-studio-product/1');
        expect(prompt).toContain('product-visuals/white-background-product/1');
        expect(prompt).toContain('各生成 2 张变体');
        expect(prompt).toContain('garden-gpt-image-2/image/');
        expect(prompt).toContain('mcp__happy__send_image');
        expect(prompt).toContain('Use the dairy reference photo and keep the plate shape.');
    });
});
