const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Allow cleartext (plain HTTP) traffic on Android for non-production builds.
 *
 * Why: Android targetSdk >= 28 blocks cleartext HTTP by default, so a *release*
 * APK cannot reach a self-hosted Happy server on a LAN address like
 * `http://192.168.x.x:3005` — `fetch()` throws and the server-config screen
 * reports "连接服务器失败". Debug builds work only because Expo injects
 * usesCleartextTraffic into the debug manifest (for Metro).
 *
 * This plugin sets android:usesCleartextTraffic="true" on the <application> tag
 * for preview/development variants so LAN HTTP servers work in installable test
 * builds. Production is left untouched (still secure / HTTPS-only).
 */
module.exports = function withCleartextTraffic(config) {
    const variant = process.env.APP_ENV || 'development';
    if (variant === 'production') {
        return config;
    }

    return withAndroidManifest(config, (cfg) => {
        const application = cfg.modResults.manifest.application?.[0];
        if (application) {
            application.$['android:usesCleartextTraffic'] = 'true';
        }
        return cfg;
    });
};
