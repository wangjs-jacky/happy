const { withAndroidManifest } = require('@expo/config-plugins');

const VISIBLE_PACKAGES = ['com.huawei.health', 'com.huawei.hwid'];

/**
 * Android 11+ hides installed packages unless they are declared under <queries>.
 * The probe only checks whether HUAWEI Health and HMS Core are present; it does
 * not request health, sensor, activity, Bluetooth, or location permissions.
 */
module.exports = function withHuaweiHealthProbe(config) {
    return withAndroidManifest(config, (manifestConfig) => {
        const manifest = manifestConfig.modResults.manifest;
        const queries = manifest.queries?.[0] ?? {};
        const packages = queries.package ?? [];

        for (const packageName of VISIBLE_PACKAGES) {
            const exists = packages.some(
                (entry) => entry.$?.['android:name'] === packageName,
            );
            if (!exists) {
                packages.push({ $: { 'android:name': packageName } });
            }
        }

        queries.package = packages;
        manifest.queries = [queries];
        return manifestConfig;
    });
};
