import { describe, expect, it } from 'vitest';
import { buildImageAgentPrompt, getImageAgentStylesForAgent } from './imageAgentPrompt';
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
    it('resolves selected GPT Image 2 styles for an image agent', () => {
        expect(getImageAgentStylesForAgent(agent).map((style) => style.id)).toEqual([
            'premium-studio',
            'white-product',
        ]);
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
        expect(prompt).toContain('premium-studio');
        expect(prompt).toContain('white-product');
        expect(prompt).toContain('2 variant(s) per style');
        expect(prompt).toContain('garden-gpt-image-2/image/');
        expect(prompt).toContain('mcp__happy__send_image');
        expect(prompt).toContain('Use the dairy reference photo and keep the plate shape.');
    });
});
