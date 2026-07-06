import { describe, expect, it, vi } from 'vitest';
import { MAX_IMAGES_PER_MESSAGE } from './useImagePicker';

vi.mock('expo-image-picker', () => ({}));
vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
}));
vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn() },
}));
vi.mock('@/utils/thumbhash', () => ({
    generateThumbhash: vi.fn(),
}));
vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

describe('useImagePicker limits', () => {
    it('allows up to 50 images per message', () => {
        expect(MAX_IMAGES_PER_MESSAGE).toBe(50);
    });
});
