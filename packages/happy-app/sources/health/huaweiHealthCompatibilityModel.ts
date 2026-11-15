export interface HuaweiPackageStatus {
    packageName: string;
    installed: boolean;
    versionName: string | null;
    versionCode: string | null;
}

export interface NativeHuaweiHealthProbeStatus {
    androidApiLevel: number;
    deviceSidePublishedMaxApiLevel: number;
    requiresAndroid14CompatibilityTest: boolean;
    huaweiHealth: HuaweiPackageStatus;
    hmsCore: HuaweiPackageStatus;
}

export type HuaweiHealthCompatibilityState =
    | 'unsupported-platform'
    | 'native-probe-unavailable'
    | 'huawei-health-missing'
    | 'hms-core-missing'
    | 'android-14-plus-unverified'
    | 'ready-for-health-sdk';

export interface HuaweiHealthCompatibility {
    state: HuaweiHealthCompatibilityState;
    canAttemptHealthSdkIntegration: boolean;
    native: NativeHuaweiHealthProbeStatus | null;
}

export function evaluateHuaweiHealthCompatibility(
    native: NativeHuaweiHealthProbeStatus,
): HuaweiHealthCompatibility {
    if (!native.huaweiHealth.installed) {
        return {
            state: 'huawei-health-missing',
            canAttemptHealthSdkIntegration: false,
            native,
        };
    }
    if (!native.hmsCore.installed) {
        return {
            state: 'hms-core-missing',
            canAttemptHealthSdkIntegration: false,
            native,
        };
    }
    if (native.requiresAndroid14CompatibilityTest) {
        return {
            state: 'android-14-plus-unverified',
            canAttemptHealthSdkIntegration: true,
            native,
        };
    }
    return {
        state: 'ready-for-health-sdk',
        canAttemptHealthSdkIntegration: true,
        native,
    };
}
