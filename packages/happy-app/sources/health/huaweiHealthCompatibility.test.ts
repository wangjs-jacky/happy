import { describe, expect, it } from 'vitest';
import {
    evaluateHuaweiHealthCompatibility,
    type NativeHuaweiHealthProbeStatus,
} from './huaweiHealthCompatibilityModel';

function status(overrides: Partial<NativeHuaweiHealthProbeStatus> = {}): NativeHuaweiHealthProbeStatus {
    return {
        androidApiLevel: 35,
        deviceSidePublishedMaxApiLevel: 33,
        requiresAndroid14CompatibilityTest: true,
        huaweiHealth: {
            packageName: 'com.huawei.health',
            installed: true,
            versionName: '15.1.4.352',
            versionCode: '150104352',
        },
        hmsCore: {
            packageName: 'com.huawei.hwid',
            installed: true,
            versionName: '6.15.0.311',
            versionCode: '61500311',
        },
        ...overrides,
    };
}

describe('evaluateHuaweiHealthCompatibility', () => {
    it('marks Android 14+ as eligible for a real-device SDK test, not as supported', () => {
        expect(evaluateHuaweiHealthCompatibility(status())).toMatchObject({
            state: 'android-14-plus-unverified',
            canAttemptHealthSdkIntegration: true,
        });
    });

    it('requires HUAWEI Health', () => {
        const native = status({
            huaweiHealth: {
                packageName: 'com.huawei.health',
                installed: false,
                versionName: null,
                versionCode: null,
            },
        });
        expect(evaluateHuaweiHealthCompatibility(native)).toMatchObject({
            state: 'huawei-health-missing',
            canAttemptHealthSdkIntegration: false,
        });
    });

    it('requires HMS Core', () => {
        const native = status({
            hmsCore: {
                packageName: 'com.huawei.hwid',
                installed: false,
                versionName: null,
                versionCode: null,
            },
        });
        expect(evaluateHuaweiHealthCompatibility(native)).toMatchObject({
            state: 'hms-core-missing',
            canAttemptHealthSdkIntegration: false,
        });
    });

    it('uses the published compatibility result on Android 13 and lower', () => {
        expect(evaluateHuaweiHealthCompatibility(status({
            androidApiLevel: 33,
            requiresAndroid14CompatibilityTest: false,
        }))).toMatchObject({
            state: 'ready-for-health-sdk',
            canAttemptHealthSdkIntegration: true,
        });
    });
});
