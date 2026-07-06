import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IMAGE_AGENT_STYLE_PRESETS } from './imageAgentPrompt';
import { IMAGE_STYLE_PREVIEW_MANIFEST } from './imageStylePreviewManifest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const previewAssetDir = resolve(currentDir, '../../assets/images/gpt-image-2/skill-examples');

describe('imageStylePreviewManifest', () => {
    it('defines one real preview asset for every GPT Image 2 style preset', () => {
        const styleIds = IMAGE_AGENT_STYLE_PRESETS.map((style) => style.id).sort();
        const previewStyleIds = Object.keys(IMAGE_STYLE_PREVIEW_MANIFEST).sort();

        expect(previewStyleIds).toEqual(styleIds);

        for (const style of IMAGE_AGENT_STYLE_PRESETS) {
            const preview = IMAGE_STYLE_PREVIEW_MANIFEST[style.id];

            expect(preview.sourceSet).toBe('garden-gpt-image-2');
            expect(existsSync(resolve(previewAssetDir, preview.fileName))).toBe(true);
        }
    });
});
