export interface OtaFloatingSwitcherRuntime {
    appConfigChannel?: string | null;
    updatesChannel?: string | null;
    applicationId?: string | null;
    isDev?: boolean;
    devModeEnabled?: boolean;
}

const PREVIEW_APPLICATION_IDS = new Set(['build.paws.preview', 'build.paws.dev']);

function normalize(value?: string | null): string | null {
    return value?.trim().toLowerCase() || null;
}

export function shouldShowOtaFloatingSwitcher(runtime: OtaFloatingSwitcherRuntime): boolean {
    const appConfigChannel = normalize(runtime.appConfigChannel);
    const updatesChannel = normalize(runtime.updatesChannel);
    const applicationId = normalize(runtime.applicationId);

    if (runtime.devModeEnabled) {
        return true;
    }

    if (appConfigChannel === 'preview' || updatesChannel === 'preview') {
        return true;
    }

    if (applicationId && PREVIEW_APPLICATION_IDS.has(applicationId)) {
        return true;
    }

    return runtime.isDev === true && appConfigChannel !== 'production' && updatesChannel !== 'production';
}
