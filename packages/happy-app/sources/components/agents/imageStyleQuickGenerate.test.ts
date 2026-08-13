import { describe, expect, it } from 'vitest';
import type { ImageAgentStylePreset } from './imageStyleTypes';
import { getImageStyleQuickGenerateCardState, getImageStyleSelectionAction } from './imageStyleQuickGenerate';

const quickImageStyle = {
    id: 'photo-to-styled-motion/cinematic-realism/1',
    inputMode: 'image-required',
    quickGenerate: true,
} as ImageAgentStylePreset;

describe('getImageStyleSelectionAction', () => {
    it('selects only the tapped quick style and submits when an image is ready', () => {
        expect(getImageStyleSelectionAction({
            style: quickImageStyle,
            hasText: false,
            userImageCount: 1,
            canSpawn: true,
            sending: false,
        })).toEqual({
            selectedStyleIds: [quickImageStyle.id],
            closeGallery: true,
            shouldSubmit: true,
        });
    });

    it('closes with the style selected when an image-required preset has no image', () => {
        expect(getImageStyleSelectionAction({
            style: quickImageStyle,
            hasText: true,
            userImageCount: 0,
            canSpawn: true,
            sending: false,
        }).shouldSubmit).toBe(false);
    });

    it('does not submit while offline or while another send is active', () => {
        expect(getImageStyleSelectionAction({
            style: quickImageStyle,
            hasText: false,
            userImageCount: 1,
            canSpawn: false,
            sending: false,
        }).shouldSubmit).toBe(false);
        expect(getImageStyleSelectionAction({
            style: quickImageStyle,
            hasText: false,
            userImageCount: 1,
            canSpawn: true,
            sending: true,
        }).shouldSubmit).toBe(false);
    });
});

describe('getImageStyleQuickGenerateCardState', () => {
    it.each([
        [{ hasInput: true, canSpawn: true, sending: false }, 'ready'],
        [{ hasInput: false, canSpawn: true, sending: false }, 'needs-photo'],
        [{ hasInput: true, canSpawn: false, sending: false }, 'machine-offline'],
        [{ hasInput: true, canSpawn: true, sending: true }, 'generating'],
    ] as const)('returns the matching visible card state', (args, expected) => {
        expect(getImageStyleQuickGenerateCardState(args)).toBe(expected);
    });
});
