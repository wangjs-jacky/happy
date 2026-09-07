import type { NativeAppUpdate } from '@/sync/apiNativeUpdate';

type Checks = {
    checkNative: () => Promise<NativeAppUpdate>;
    checkOta: () => Promise<{ isAvailable: boolean }>;
    fetchOta: () => Promise<{ isNew: boolean }>;
};
export async function checkAppUpdates(checks: Checks): Promise<
    { kind: 'native'; url: string } | { kind: 'ota'; nativeCheckFailed: boolean }
    | { kind: 'current' } | { kind: 'unknown' } | { kind: 'ota-current-only' }
> {
    let nativeCheckFailed = false;
    let nativeUnsupported = false;
    try {
        const native = await checks.checkNative();
        if (native.available && native.updateUrl) return { kind: 'native', url: native.updateUrl };
        nativeUnsupported = native.status === 'unsupported';
    } catch { nativeCheckFailed = true; }
    const ota = await checks.checkOta();
    if (ota.isAvailable) {
        const downloaded = await checks.fetchOta();
        if (!downloaded.isNew) throw new Error('OTA download did not produce a new update');
        return { kind: 'ota', nativeCheckFailed };
    }
    return { kind: nativeCheckFailed ? 'unknown' : nativeUnsupported ? 'ota-current-only' : 'current' };
}
