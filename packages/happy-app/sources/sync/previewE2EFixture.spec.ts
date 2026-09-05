import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewE2EFixture, resolvePreviewE2EFixture } from './previewE2EFixture';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('createPreviewE2EFixture', () => {
    const authenticatedUrl = 'http://localhost:8081/settings/temporary-previews?dev_token=token&dev_secret=secret';

    it('is disabled unless the explicit non-production authenticated fixture gate is satisfied', () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('EXPO_PUBLIC_HAPPY_E2E_FIXTURES', '');
        expect(createPreviewE2EFixture(`${authenticatedUrl}&happy_preview_fixture=connected`)).toBeNull();

        vi.stubEnv('EXPO_PUBLIC_HAPPY_E2E_FIXTURES', '1');
        expect(createPreviewE2EFixture('http://localhost:8081/settings/temporary-previews?happy_preview_fixture=connected')).toBeNull();

        vi.stubEnv('NODE_ENV', 'production');
        expect(createPreviewE2EFixture(`${authenticatedUrl}&happy_preview_fixture=connected`)).toBeNull();
    });

    it('provides deterministic connection, callback, retry, and disconnect-warning states', () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('EXPO_PUBLIC_HAPPY_E2E_FIXTURES', '1');

        const disconnected = createPreviewE2EFixture(`${authenticatedUrl}&happy_preview_fixture=disconnected`)!;
        expect(disconnected.getStatus()).toMatchObject({ available: true, connected: false });
        expect(disconnected.connectUrl()).toContain('happy_preview_fixture=connected');
        expect(disconnected.connectUrl()).toContain('vercel=connected');
        disconnected.markConnected();
        expect(disconnected.getStatus()).toMatchObject({ connected: true, account: { projectId: 'happy-previews' } });

        const retry = createPreviewE2EFixture(`${authenticatedUrl}&happy_preview_fixture=error-once`)!;
        expect(() => retry.getStatus()).toThrow('deterministic E2E fixture failure');
        expect(() => retry.getStatus()).toThrow('deterministic E2E fixture failure');
        retry.allowRetry();
        expect(retry.getStatus()).toMatchObject({ available: true, connected: false });

        const warning = createPreviewE2EFixture(`${authenticatedUrl}&happy_preview_fixture=disconnect-warning`)!;
        expect(warning.disconnect()).toEqual({ warning: 'VERCEL_DEPLOYMENT_CLEANUP_PENDING' });
        expect(warning.getStatus()).toMatchObject({ connected: false });
    });

    it('can attach after an earlier render occurred before the authenticated fixture URL was available', () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('EXPO_PUBLIC_HAPPY_E2E_FIXTURES', '1');

        const initial = resolvePreviewE2EFixture(null, 'http://localhost:8081/settings/temporary-previews');
        expect(initial).toBeNull();

        const attached = resolvePreviewE2EFixture(initial, `${authenticatedUrl}&happy_preview_fixture=disconnected`);
        expect(attached?.getStatus()).toMatchObject({ available: true, connected: false });
        expect(resolvePreviewE2EFixture(attached, `${authenticatedUrl}&happy_preview_fixture=connected`)).toBe(attached);
    });
});
