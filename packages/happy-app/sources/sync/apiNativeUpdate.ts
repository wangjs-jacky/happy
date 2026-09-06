import { compareVersions } from '@/utils/versionUtils';

const validVersion = (value: unknown): value is string => typeof value === 'string'
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    && value.split('.').every(part => Number.isSafeInteger(Number(part)));
const validRuntime = (value: unknown): value is string => typeof value === 'string'
    && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

export type NativeAppIdentity = {
    platform: string; appId: string | null; version: string | null;
    runtimeVersion: string | null; channel: string | null;
};
export type NativeAppUpdate = { status: 'update-available' | 'up-to-date' | 'unsupported'; available: boolean; updateUrl?: string };

export async function checkNativeAppUpdate(serverUrl: string, identity: NativeAppIdentity): Promise<NativeAppUpdate> {
    if (identity.platform !== 'android' || !['build.paws', 'build.paws.preview'].includes(identity.appId ?? '')) {
        return { status: 'unsupported', available: false };
    }
    if (!validVersion(identity.version) || !validRuntime(identity.runtimeVersion)) throw new Error('Unable to determine the installed app version');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetch(`${serverUrl}/v1/version`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ platform: identity.platform, version: identity.version, app_id: identity.appId,
                channel: identity.channel ?? undefined, runtime_version: identity.runtimeVersion }),
        });
        if (!response.ok) throw new Error(`App update check failed (${response.status})`);
        const data = await response.json();
        if (data?.status === 'update-available') {
            if (data.update_required !== true || data.update_url !== data.updateUrl) throw new Error('Inconsistent App update response');
            const url = data.update_url ?? data.updateUrl;
            const variant = identity.appId === 'build.paws' ? 'production' : 'preview';
            const pattern = new RegExp(`^https://github\\.com/wangjs-jacky/happy/releases/download/android-[A-Za-z0-9._-]+/paws-${variant}-v(\\d+\\.\\d+\\.\\d+)-runtime(\\d+)-[a-f0-9]{7,40}-arm64\\.apk$`);
            const match = typeof url === 'string' ? pattern.exec(url) : null;
            if (!match) throw new Error('Invalid App download address');
            if (!validVersion(data.version) || !validRuntime(data.runtime_version)
                || match[1] !== data.version || match[2] !== data.runtime_version
                || Number(data.runtime_version) < Number(identity.runtimeVersion)
                || compareVersions(data.version, identity.version) < 0
                || (data.runtime_version === identity.runtimeVersion && data.version === identity.version)) {
                throw new Error('Invalid App upgrade target');
            }
            return { status: 'update-available', available: true, updateUrl: url };
        }
        if (data?.status === 'up-to-date' && data.update_required === false && data.update_url === null && data.updateUrl === null) {
            return { status: 'up-to-date', available: false };
        }
        if (data?.status === 'unsupported' && data.update_required === false && data.update_url === null && data.updateUrl === null) {
            return { status: 'unsupported', available: false };
        }
        throw new Error('Unable to confirm whether a newer App is available');
    } finally { clearTimeout(timeout); }
}
