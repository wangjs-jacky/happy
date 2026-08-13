import { describe, expect, it } from 'vitest';
import { IMAGE_AGENT_STYLE_PRESETS } from './imageAgentPrompt';
import { IMAGE_STYLE_PREVIEW_MANIFEST } from './imageStylePreviewManifest';

const EXPECTED_SLUGS = [
    'japanese-cinema-film',
    'handdrawn-anime-film',
    '90s-cel-animation',
    'seinen-manga-bw',
    'cyberpunk-graphic-novel',
    'abstract-screenprint-collage',
    'ink-wash-portrait',
    'vintage-editorial-film',
    'cinematic-realism',
];

describe('photo-to-styled-motion presets', () => {
    it('keeps the reviewed gallery order and enables one-tap generation', () => {
        const styles = IMAGE_AGENT_STYLE_PRESETS.filter((style) => style.categoryId === 'photo-to-styled-motion');

        expect(styles.map((style) => style.id)).toEqual(
            EXPECTED_SLUGS.map((slug) => `photo-to-styled-motion/${slug}/1`),
        );
        for (const style of styles) {
            expect(style).toMatchObject({
                executionKind: 'gpt-image-2',
                inputMode: 'image-required',
                multiInputMode: 'single',
                continuationSourceMode: 'original-upload',
                quickGenerate: true,
            });
            expect(IMAGE_STYLE_PREVIEW_MANIFEST[style.id]?.sourceSet).toBe('photo-to-styled-motion');
        }
    });
});
