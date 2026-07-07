import { describe, expect, it } from 'vitest';
import {
    getScreenshotMenuItems,
    SCREENSHOT_MENU_LAYOUT,
    shouldShowScreenshotCapture,
} from './messageComposerScreenshotMenu';

describe('message composer screenshot menu', () => {
    it('renders all screenshot actions from a modal so the composer panel cannot clip it', () => {
        expect(SCREENSHOT_MENU_LAYOUT).toEqual({
            host: 'modal',
            avoidsClippingPanel: true,
        });

        expect(getScreenshotMenuItems({ includeGallery: true })).toEqual([
            {
                key: 'desktop',
                icon: 'desktop-outline',
                labelKey: 'components.messageComposer.screenshotDesktop',
                target: 'desktop',
            },
            {
                key: 'browser',
                icon: 'globe-outline',
                labelKey: 'components.messageComposer.screenshotBrowser',
                target: 'browser',
            },
            {
                key: 'gallery',
                icon: 'images-outline',
                labelKey: 'components.screenshotGallery.title',
            },
        ]);
    });

    it('omits the gallery action when the session does not provide a gallery handler', () => {
        expect(getScreenshotMenuItems({ includeGallery: false }).map((item) => item.key)).toEqual([
            'desktop',
            'browser',
        ]);
    });

    it('shows screenshot capture only for macOS sessions or sessions without legacy OS metadata', () => {
        expect(shouldShowScreenshotCapture('darwin')).toBe(true);
        expect(shouldShowScreenshotCapture('Darwin')).toBe(true);
        expect(shouldShowScreenshotCapture(undefined)).toBe(true);
        expect(shouldShowScreenshotCapture(null)).toBe(true);
        expect(shouldShowScreenshotCapture('')).toBe(true);

        expect(shouldShowScreenshotCapture('linux')).toBe(false);
        expect(shouldShowScreenshotCapture('win32')).toBe(false);
    });
});
