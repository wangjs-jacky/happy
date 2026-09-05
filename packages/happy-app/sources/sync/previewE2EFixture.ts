import type { VercelPreviewStatus } from './apiInteractivePreviews';

export const PREVIEW_E2E_FIXTURE_PARAM = 'happy_preview_fixture';

export type PreviewE2EFixtureName =
    | 'connected'
    | 'disconnected'
    | 'disconnect-warning'
    | 'error-once'
    | 'unavailable';

const CONNECTED_STATUS: VercelPreviewStatus = {
    available: true,
    connected: true,
    account: {
        teamId: 'team_happy_fixture',
        teamName: 'Happy Design Fixture',
        projectId: 'happy-previews',
    },
};

const DISCONNECTED_STATUS: VercelPreviewStatus = {
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
    connectUrl: () => string;
    disconnect: () => { warning?: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' };
    getStatus: () => VercelPreviewStatus;
    markConnected: () => void;
} | null {
    if (process.env.NODE_ENV === 'production'
        || process.env.EXPO_PUBLIC_HAPPY_E2E_FIXTURES !== '1') return null;

    const location = new URL(locationHref);
    if (!location.searchParams.has('dev_token') || !location.searchParams.has('dev_secret')) return null;
    const fixtureName = location.searchParams.get(PREVIEW_E2E_FIXTURE_PARAM);
    if (!isFixtureName(fixtureName)) return null;

    let current: VercelPreviewStatus = fixtureName === 'unavailable'
        ? { available: false, connected: false }
        : fixtureName === 'connected' || fixtureName === 'disconnect-warning'
            ? CONNECTED_STATUS
            : DISCONNECTED_STATUS;
    let errorPending = fixtureName === 'error-once';

    return {
        allowRetry: () => {
            errorPending = false;
        },
        connectUrl: () => {
            const callback = new URL(location);
            callback.searchParams.set(PREVIEW_E2E_FIXTURE_PARAM, 'connected');
            callback.searchParams.set('vercel', 'connected');
            return callback.toString();
        },
        disconnect: () => {
            current = DISCONNECTED_STATUS;
            return fixtureName === 'disconnect-warning'
                ? { warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' }
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
