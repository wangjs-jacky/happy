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

        expect(prompt).toContain('Use the $gpt-image-2 skill');
        expect(prompt).toContain('Selected Garden case: product-visuals/white-background-product/1');
        expect(prompt).toContain(style!.promptContent.slice(0, 120));
    });

    it('builds a locked multi-image GPT Image 2 batch prompt', () => {
        const prompt = buildImageAgentPrompt({
            agent,
            userPrompt: 'Use the dairy reference photo and keep the plate shape.',
            imageCount: 3,
        });

        expect(prompt).toContain('$gpt-image-2');
        expect(prompt).toContain('Generation lock');
        expect(prompt).toContain('3 uploaded reference image(s)');
        expect(prompt).toContain('product-visuals/premium-studio-product/1');
        expect(prompt).toContain('product-visuals/white-background-product/1');
        expect(prompt).toContain('2 variant(s) per style');
        expect(prompt).toContain('garden-gpt-image-2/image/');
        expect(prompt).toContain('mcp__happy__send_image');
        expect(prompt).toContain('Use the dairy reference photo and keep the plate shape.');
    });
});
