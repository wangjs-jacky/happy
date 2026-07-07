import { describe, expect, it } from 'vitest';
import { getScreenshotFailureKind } from './screenshotErrors';

describe('getScreenshotFailureKind', () => {
    it('classifies macOS display capture failures from the CLI stable marker', () => {
        expect(getScreenshotFailureKind('SCREEN_CAPTURE_UNAVAILABLE: could not create image from display')).toBe('displayUnavailable');
    });

    it('classifies raw screencapture display stderr for older CLI versions', () => {
        expect(getScreenshotFailureKind('screencapture 退出码 1: could not create image from display')).toBe('displayUnavailable');
    });

    it('classifies opaque screencapture exit code from already-running older CLI sessions', () => {
        expect(getScreenshotFailureKind('screencapture 退出码 1')).toBe('displayUnavailable');
    });

    it('classifies unsupported platform errors separately', () => {
        expect(getScreenshotFailureKind('截图当前仅支持 macOS，检测到平台 linux')).toBe('unsupportedPlatform');
    });

    it('leaves unknown errors for raw display', () => {
        expect(getScreenshotFailureKind('boom')).toBe('unknown');
    });
});
