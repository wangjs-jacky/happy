export type ScreenshotFailureKind = 'unsupportedPlatform' | 'displayUnavailable' | 'unknown';

export function getScreenshotFailureKind(error: string | undefined): ScreenshotFailureKind {
    if (!error) {
        return 'unknown';
    }

    if (/SCREEN_CAPTURE_UNAVAILABLE|could not create image from display|screencapture 退出码|屏幕录制|图形显示会话/i.test(error)) {
        return 'displayUnavailable';
    }

    if (/macOS|platform|仅支持/i.test(error)) {
        return 'unsupportedPlatform';
    }

    return 'unknown';
}
