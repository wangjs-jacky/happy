const {
    AndroidConfig,
    withAndroidManifest,
    withMainActivity,
} = require('@expo/config-plugins');

const HEALTH_CONNECT_PROVIDER = 'com.google.android.apps.healthdata';
const DELEGATE_IMPORT =
    'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
const DELEGATE_CALL = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)';

function addPermissionDelegate(contents) {
    let next = contents;

    if (!next.includes(DELEGATE_IMPORT)) {
        const packageDeclaration = next.match(/^package\s+[^\n]+\n/m);
        if (!packageDeclaration) {
            throw new Error('Unable to find the Android MainActivity package declaration.');
        }
        next = next.replace(
            packageDeclaration[0],
            `${packageDeclaration[0]}\n${DELEGATE_IMPORT}\n`,
        );
    }

    if (!next.includes(DELEGATE_CALL)) {
        const superOnCreate = /super\.onCreate\((?:null|savedInstanceState)\)/;
        if (!superOnCreate.test(next)) {
            throw new Error('Unable to find MainActivity.onCreate for Health Connect setup.');
        }
        next = next.replace(
            superOnCreate,
            (match) => `${match}\n    ${DELEGATE_CALL}`,
        );
    }

    return next;
}

function ensureMainActivityRationaleIntent(androidManifest) {
    const mainActivity =
        AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
    const filters = mainActivity['intent-filter'] ?? [];
    const alreadyPresent = filters.some((filter) =>
        filter.action?.some(
            (action) =>
                action.$?.['android:name'] ===
                'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE',
        ),
    );

    if (!alreadyPresent) {
        filters.push({
            action: [
                {
                    $: {
                        'android:name':
                            'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE',
                    },
                },
            ],
        });
    }
    mainActivity['intent-filter'] = filters;
}

function ensureAndroid14PermissionUsageAlias(androidManifest) {
    const application =
        AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
    const aliases = application['activity-alias'] ?? [];
    const aliasName = '.ViewHealthPermissionUsageActivity';
    const alreadyPresent = aliases.some(
        (alias) => alias.$?.['android:name'] === aliasName,
    );

    if (!alreadyPresent) {
        aliases.push({
            $: {
                'android:name': aliasName,
                'android:exported': 'true',
                'android:targetActivity': '.MainActivity',
                'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
            },
            'intent-filter': [
                {
                    action: [
                        {
                            $: {
                                'android:name':
                                    'android.intent.action.VIEW_PERMISSION_USAGE',
                            },
                        },
                    ],
                    category: [
                        {
                            $: {
                                'android:name':
                                    'android.intent.category.HEALTH_PERMISSIONS',
                            },
                        },
                    ],
                },
            ],
        });
    }
    application['activity-alias'] = aliases;
}

module.exports = function withHealthConnect(config) {
    config = withMainActivity(config, (activityConfig) => {
        if (activityConfig.modResults.language !== 'kt') {
            throw new Error('Health Connect setup currently expects a Kotlin MainActivity.');
        }
        activityConfig.modResults.contents = addPermissionDelegate(
            activityConfig.modResults.contents,
        );
        return activityConfig;
    });

    return withAndroidManifest(config, (manifestConfig) => {
        const androidManifest = manifestConfig.modResults;
        const manifest = androidManifest.manifest;
        const queries = manifest.queries?.[0] ?? {};
        const packages = queries.package ?? [];
        const providerAlreadyVisible = packages.some(
            (entry) => entry.$?.['android:name'] === HEALTH_CONNECT_PROVIDER,
        );
        if (!providerAlreadyVisible) {
            packages.push({ $: { 'android:name': HEALTH_CONNECT_PROVIDER } });
        }
        queries.package = packages;
        manifest.queries = [queries];

        ensureMainActivityRationaleIntent(androidManifest);
        ensureAndroid14PermissionUsageAlias(androidManifest);
        return manifestConfig;
    });
}
