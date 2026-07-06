import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IMAGE_AGENT_STYLE_PRESETS } from './imageAgentPrompt';
import { IMAGE_STYLE_PREVIEW_MANIFEST } from './imageStylePreviewManifest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const previewAssetDir = resolve(currentDir, '../../assets/images/gpt-image-2/skill-examples');
const GARDEN_CASE_COUNT = 162;
const GARDEN_CATEGORY_COUNT = 17;

describe('imageStylePreviewManifest', () => {
    it('defines one real preview asset for every Garden GPT Image 2 case style', () => {
        expect(IMAGE_AGENT_STYLE_PRESETS).toHaveLength(GARDEN_CASE_COUNT);

        const styleIds = IMAGE_AGENT_STYLE_PRESETS.map((style) => style.id).sort();
        const previewStyleIds = Object.keys(IMAGE_STYLE_PREVIEW_MANIFEST).sort();
        const categoryIds = new Set(IMAGE_AGENT_STYLE_PRESETS.map((style) => style.categoryId));

        expect(previewStyleIds).toEqual(styleIds);
        expect(categoryIds.size).toBe(GARDEN_CATEGORY_COUNT);

        for (const style of IMAGE_AGENT_STYLE_PRESETS) {
            const preview = IMAGE_STYLE_PREVIEW_MANIFEST[style.id];

            expect(style.promptContent.length).toBeGreaterThan(200);
            expect(style.title.length).toBeGreaterThan(0);
            expect(style.templateRef).toMatch(/^.+\.md$/);
            expect(preview.sourceSet).toBe('gpt-image-2-101');
            expect(existsSync(resolve(previewAssetDir, preview.fileName))).toBe(true);
        }
    });
});
