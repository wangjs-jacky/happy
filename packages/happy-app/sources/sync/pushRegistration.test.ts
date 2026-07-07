import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const constantsMock = vi.hoisted(() => ({
    expoConfig: {},
    easConfig: undefined as { projectId?: string } | undefined,
}));

const notificationsMock = vi.hoisted(() => ({
    getPermissionsAsync: vi.fn(),
    requestPermissionsAsync: vi.fn(),
    getExpoPushTokenAsync: vi.fn(),
    getDevicePushTokenAsync: vi.fn(),
}));

const persistenceMock = vi.hoisted(() => ({
    loadRegisteredPushToken: vi.fn(),
    saveRegisteredPushToken: vi.fn(),
    clearRegisteredPushToken: vi.fn(),
}));

const apiPushMock = vi.hoisted(() => ({
    registerPushToken: vi.fn(),
    unregisterPushToken: vi.fn(),
}));

vi.mock('react-native', () => ({
    Linking: { openSettings: vi.fn() },
    Platform: { OS: 'android' },
}));

vi.mock('expo-constants', () => ({
    default: constantsMock,
}));

vi.mock('expo-notifications', () => notificationsMock);

vi.mock('expo-application', () => ({
    nativeApplicationVersion: '1.7.1',
    nativeBuildVersion: '21',
}));

vi.mock('expo-device', () => ({
    deviceName: 'Test Phone',
    modelName: 'Test Phone',
    osName: 'Android',
    osVersion: '15',
    isDevice: true,
}));

vi.mock('./persistence', () => persistenceMock);

vi.mock('./apiPush', () => apiPushMock);

import { syncCurrentPushToken } from './pushRegistration';

describe('pushRegistration', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        constantsMock.expoConfig = {};
        constantsMock.easConfig = undefined;
        vi.clearAllMocks();
        persistenceMock.loadRegisteredPushToken.mockReturnValue(null);
        notificationsMock.getPermissionsAsync.mockResolvedValue({
            status: 'granted',
            granted: true,
            canAskAgain: false,
        });
        notificationsMock.getExpoPushTokenAsync.mockResolvedValue({
            data: 'ExponentPushToken[current-device]',
        });
        notificationsMock.getDevicePushTokenAsync.mockResolvedValue({
            type: 'fcm',
            data: 'fcm-current-device',
        });
        apiPushMock.registerPushToken.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('registers the Android Expo push token before trying a native FCM token', async () => {
        const result = await syncCurrentPushToken({
            token: 'auth-token',
            secret: 'auth-secret',
        });

        expect(notificationsMock.getExpoPushTokenAsync).toHaveBeenCalledWith({
            projectId: '4558dd3d-cd5a-47cd-bad9-e591a241cc06',
        });
        expect(notificationsMock.getDevicePushTokenAsync).not.toHaveBeenCalled();
        expect(apiPushMock.registerPushToken).toHaveBeenCalledWith(
            { token: 'auth-token', secret: 'auth-secret' },
            'ExponentPushToken[current-device]',
        );
        expect(result).toMatchObject({
            registered: true,
            token: 'ExponentPushToken[current-device]',
        });
    });

    it('falls back to the Android native FCM token when Expo push token lookup fails', async () => {
        notificationsMock.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('Expo unavailable'));

        const result = await syncCurrentPushToken({
            token: 'auth-token',
            secret: 'auth-secret',
        });

        expect(notificationsMock.getExpoPushTokenAsync).toHaveBeenCalledWith({
            projectId: '4558dd3d-cd5a-47cd-bad9-e591a241cc06',
        });
        expect(notificationsMock.getDevicePushTokenAsync).toHaveBeenCalled();
        expect(apiPushMock.registerPushToken).toHaveBeenCalledWith(
            { token: 'auth-token', secret: 'auth-secret' },
            'fcm-current-device',
        );
        expect(result).toMatchObject({
            registered: true,
            token: 'fcm-current-device',
        });
    });

    it('prefers the Expo project ID from runtime constants', async () => {
        constantsMock.expoConfig = {
            extra: {
                eas: {
                    projectId: 'runtime-project-id',
                },
            },
        };

        await syncCurrentPushToken({
            token: 'auth-token',
            secret: 'auth-secret',
        });

        expect(notificationsMock.getExpoPushTokenAsync).toHaveBeenCalledWith({
            projectId: 'runtime-project-id',
        });
    });

    it('returns the token lookup error without registering a stale token when Expo and native lookup both fail', async () => {
        notificationsMock.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('Expo unavailable'));
        notificationsMock.getDevicePushTokenAsync.mockRejectedValueOnce(new Error('FCM unavailable'));
        persistenceMock.loadRegisteredPushToken.mockReturnValue('ExponentPushToken[stale-device]');

        const result = await syncCurrentPushToken({
            token: 'auth-token',
            secret: 'auth-secret',
        });

        expect(apiPushMock.registerPushToken).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            registered: false,
            token: 'ExponentPushToken[stale-device]',
            error: 'Expo unavailable; Android native fallback failed: FCM unavailable',
        });
    });
});
