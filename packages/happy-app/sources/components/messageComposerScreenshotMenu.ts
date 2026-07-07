export type ScreenshotMenuTarget = 'desktop' | 'browser';
export type ScreenshotMenuItemKey = ScreenshotMenuTarget | 'gallery';

export type ScreenshotMenuItem =
    | {
        key: ScreenshotMenuTarget;
        icon: 'desktop-outline' | 'globe-outline';
        labelKey: 'components.messageComposer.screenshotDesktop' | 'components.messageComposer.screenshotBrowser';
        target: ScreenshotMenuTarget;
    }
    | {
        key: 'gallery';
        icon: 'images-outline';
        labelKey: 'components.screenshotGallery.title';
    };

export const SCREENSHOT_MENU_LAYOUT = {
    host: 'modal',
    avoidsClippingPanel: true,
} as const;

export function shouldShowScreenshotCapture(os: string | null | undefined): boolean {
    const normalized = os?.trim().toLowerCase();
    return !normalized || normalized === 'darwin';
}

export function getScreenshotMenuItems({
    includeGallery,
}: {
    includeGallery: boolean;
}): ScreenshotMenuItem[] {
    const items: ScreenshotMenuItem[] = [
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
    ];

    if (includeGallery) {
        items.push({
            key: 'gallery',
            icon: 'images-outline',
            labelKey: 'components.screenshotGallery.title',
        });
    }

    return items;
}
