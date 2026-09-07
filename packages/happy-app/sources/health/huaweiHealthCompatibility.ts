import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import {
    evaluateHuaweiHealthCompatibility,
    type HuaweiHealthCompatibility,
    type NativeHuaweiHealthProbeStatus,
} from './huaweiHealthCompatibilityModel';

export {
    evaluateHuaweiHealthCompatibility,
} from './huaweiHealthCompatibilityModel';
export type {
    HuaweiHealthCompatibility,
    HuaweiHealthCompatibilityState,
    HuaweiPackageStatus,
    NativeHuaweiHealthProbeStatus,
} from './huaweiHealthCompatibilityModel';

interface HuaweiHealthProbeNativeModule {
    getStatus(): Promise<NativeHuaweiHealthProbeStatus>;
}

export async function getHuaweiHealthCompatibilityStatus(): Promise<HuaweiHealthCompatibility> {
    if (Platform.OS !== 'android') {
        return {
            state: 'unsupported-platform',
            canAttemptHealthSdkIntegration: false,
            native: null,
        };
    }

    const probe = requireOptionalNativeModule<HuaweiHealthProbeNativeModule>('HuaweiHealthProbe');
    if (!probe) {
        return {
            state: 'native-probe-unavailable',
            canAttemptHealthSdkIntegration: false,
            native: null,
        };
    }

    return evaluateHuaweiHealthCompatibility(await probe.getStatus());
}
