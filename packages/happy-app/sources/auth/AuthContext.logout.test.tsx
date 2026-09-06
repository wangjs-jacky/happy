import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    clearPersistence: vi.fn(),
    clearSessionWarmCache: vi.fn(),
    removeCredentials: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'native' } }));
vi.mock('expo-updates', () => ({ reloadAsync: mocks.reload }));
vi.mock('@/auth/tokenStorage', () => ({
    TokenStorage: {
        removeCredentials: mocks.removeCredentials,
        setCredentials: vi.fn(async () => true),
    },
}));
vi.mock('@/sync/sync', () => ({ syncCreate: vi.fn() }));
vi.mock('@/sync/persistence', () => ({
    clearPersistence: mocks.clearPersistence,
    loadRegisteredPushToken: vi.fn(() => null),
}));
vi.mock('@/sync/sessionWarmCache', () => ({
    clearSessionWarmCache: mocks.clearSessionWarmCache,
}));
vi.mock('@/sync/apiPush', () => ({ unregisterPushToken: vi.fn() }));
vi.mock('@/track', () => ({ trackLogout: vi.fn() }));
vi.mock('@/sync/publicSessionShareQueueRuntime', () => ({ clearPublicSessionShareJobs: vi.fn() }));

import { AuthProvider, getCurrentAuth } from './AuthContext';

describe('AuthProvider logout', () => {
    beforeEach(() => vi.clearAllMocks());

    it('clears the encrypted session warm cache with the rest of local account data', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <AuthProvider initialCredentials={{ token: 'token', secret: 'secret' }}>
                    <></>
                </AuthProvider>,
            );
        });

        await act(async () => {
            await getCurrentAuth()?.logout();
        });

        expect(mocks.clearPersistence).toHaveBeenCalledOnce();
        expect(mocks.clearSessionWarmCache).toHaveBeenCalledOnce();
        expect(mocks.removeCredentials).toHaveBeenCalledOnce();
        renderer.unmount();
    });
});
