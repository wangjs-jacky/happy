import type { CloudflarePreviewStatus } from './apiInteractivePreviews';

export const PREVIEW_E2E_FIXTURE_PARAM = 'happy_preview_fixture';

export type PreviewE2EFixtureName =
    | 'connected'
    | 'disconnected'
    | 'disconnect-warning'
    | 'error-once'
    | 'unavailable';

const CONNECTED_STATUS: CloudflarePreviewStatus = {
    available: true,
    connected: true,
    account: {
        accountId: 'team_happy_fixture',
        projectId: 'happy-previews',
    },
};

const DISCONNECTED_STATUS: CloudflarePreviewStatus = {
    available: true,
    connected: false,
};

function isFixtureName(value: string | null): value is PreviewE2EFixtureName {
    return value === 'connected'
        || value === 'disconnected'
        || value === 'disconnect-warning'
        || value === 'error-once'
        || value === 'unavailable';
}

/**
 * A deterministic, local-only settings fixture for visual/Ego verification.
 * It is intentionally unavailable in production builds, without the explicit
 * public E2E flag, or without the isolated environment's dev auth.
 */
export function createPreviewE2EFixture(locationHref: string): {
    allowRetry: () => void;
    disconnect: () => { warning?: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' };
    getStatus: () => CloudflarePreviewStatus;
    markConnected: () => void;
} | null {
    if (process.env.NODE_ENV === 'production'
        || process.env.EXPO_PUBLIC_HAPPY_E2E_FIXTURES !== '1') return null;

    const location = new URL(locationHref);
    if (!location.searchParams.has('dev_token') || !location.searchParams.has('dev_secret')) return null;
    const fixtureName = location.searchParams.get(PREVIEW_E2E_FIXTURE_PARAM);
    if (!isFixtureName(fixtureName)) return null;

    let current: CloudflarePreviewStatus = fixtureName === 'unavailable'
        ? { available: false, connected: false }
        : fixtureName === 'connected' || fixtureName === 'disconnect-warning'
            ? CONNECTED_STATUS
            : DISCONNECTED_STATUS;
    let errorPending = fixtureName === 'error-once';

    return {
        allowRetry: () => {
            errorPending = false;
        },
        disconnect: () => {
            current = DISCONNECTED_STATUS;
            return fixtureName === 'disconnect-warning'
                ? { warning: 'CLOUDFLARE_DEPLOYMENT_CLEANUP_PENDING' }
                : {};
        },
        getStatus: () => {
            if (errorPending) {
                throw new Error('deterministic E2E fixture failure');
            }
            return current;
        },
        markConnected: () => {
            current = CONNECTED_STATUS;
        },
    };
}

export function resolvePreviewE2EFixture(
    current: ReturnType<typeof createPreviewE2EFixture>,
    locationHref: string,
): ReturnType<typeof createPreviewE2EFixture> {
    return current ?? createPreviewE2EFixture(locationHref);
}
