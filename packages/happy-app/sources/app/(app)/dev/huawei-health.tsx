import * as React from 'react';
import { Stack } from 'expo-router';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import {
    getHuaweiHealthCompatibilityStatus,
    type HuaweiHealthCompatibility,
    type HuaweiHealthCompatibilityState,
} from '@/health/huaweiHealthCompatibility';
import {
    getHealthConnectSnapshot,
    showHealthConnectSettings,
    type HealthConnectSnapshot,
    type HealthConnectState,
} from '@/health/healthConnect';

const STATE_LABELS: Record<HuaweiHealthCompatibilityState, string> = {
    'unsupported-platform': 'Android only',
    'native-probe-unavailable': 'Install a new native build',
    'huawei-health-missing': 'HUAWEI Health is not installed',
    'hms-core-missing': 'HMS Core is not installed',
    'android-14-plus-unverified': 'Ready for Android 14+ real-device test',
    'ready-for-health-sdk': 'Ready for Health Service Kit',
};

const HEALTH_CONNECT_STATE_LABELS: Record<HealthConnectState, string> = {
    'unsupported-platform': 'Android only',
    'sdk-unavailable': 'Health Connect is unavailable',
    'provider-update-required': 'Health Connect update required',
    'permissions-required': 'Sleep or heart-rate permission required',
    ready: 'Ready',
};

function minutesLabel(minutes: number | null): string {
    if (minutes == null) return 'No data';
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

export default function HuaweiHealthDiagnosticsScreen() {
    const [result, setResult] = React.useState<HuaweiHealthCompatibility | null>(null);
    const [healthConnect, setHealthConnect] =
        React.useState<HealthConnectSnapshot | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(true);

    const refresh = React.useCallback(async (requestPermissions = false) => {
        setLoading(true);
        setError(null);
        try {
            const [compatibility, snapshot] = await Promise.all([
                getHuaweiHealthCompatibilityStatus(),
                getHealthConnectSnapshot({
                    requestMissingPermissions: requestPermissions,
                }),
            ]);
            setResult(compatibility);
            setHealthConnect(snapshot);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    const native = result?.native;
    const sleep = healthConnect?.sleep;
    const heartRate = healthConnect?.heartRate;
    const packageDetail = (installed: boolean, versionName: string | null) =>
        installed ? `Installed${versionName ? ` · ${versionName}` : ''}` : 'Not installed';

    return (
        <>
            <Stack.Screen options={{ title: 'HUAWEI Health bridge' }} />
            <ItemList>
                <ItemGroup
                    title="Health Connect bridge"
                    footer="Expected path: HUAWEI Band → HUAWEI Health → Health Sync → Health Connect → Paws. Paws only asks for read access."
                >
                    <Item
                        title="Status"
                        detail={
                            loading
                                ? 'Checking…'
                                : error ??
                                  (healthConnect
                                      ? HEALTH_CONNECT_STATE_LABELS[healthConnect.state]
                                      : 'Unknown')
                        }
                    />
                    <Item
                        title="Sleep permission"
                        detail={healthConnect?.permissions.sleep ? 'Granted' : 'Not granted'}
                    />
                    <Item
                        title="Heart-rate permission"
                        detail={healthConnect?.permissions.heartRate ? 'Granted' : 'Not granted'}
                    />
                    <Item
                        title="Grant access / refresh data"
                        onPress={() => void refresh(true)}
                        disabled={loading}
                    />
                    <Item
                        title="Open Health Connect settings"
                        onPress={showHealthConnectSettings}
                    />
                </ItemGroup>

                <ItemGroup
                    title="Last 48 hours"
                    footer={
                        sleep?.dataOrigins.length || heartRate?.dataOrigins.length
                            ? `Sources: ${[...(sleep?.dataOrigins ?? []), ...(heartRate?.dataOrigins ?? [])]
                                  .filter((value, index, all) => all.indexOf(value) === index)
                                  .join(', ')}`
                            : 'No source records returned yet. Run a manual sync in Health Sync, then refresh.'
                    }
                >
                    <Item title="Main sleep" detail={minutesLabel(sleep?.totalMinutes ?? null)} />
                    <Item title="Deep / light / REM" detail={
                        `${minutesLabel(sleep?.deepMinutes ?? null)} / ${minutesLabel(sleep?.lightMinutes ?? null)} / ${minutesLabel(sleep?.remMinutes ?? null)}`
                    } />
                    <Item title="Nap" detail={minutesLabel(sleep?.napMinutes ?? null)} />
                    <Item
                        title="Heart rate avg / range"
                        detail={
                            heartRate?.averageBpm == null
                                ? 'No data'
                                : `${heartRate.averageBpm} bpm · ${heartRate.minimumBpm}–${heartRate.maximumBpm}`
                        }
                    />
                    <Item
                        title="Latest heart rate"
                        detail={
                            heartRate?.latestBpm == null
                                ? 'No data'
                                : `${heartRate.latestBpm} bpm`
                        }
                    />
                </ItemGroup>

                <ItemGroup
                    title="Huawei apps"
                    footer="This package check helps diagnose the source side. The bridge itself does not require a Huawei developer account."
                >
                    <Item
                        title="HUAWEI Health"
                        detail={native ? packageDetail(native.huaweiHealth.installed, native.huaweiHealth.versionName) : 'N/A'}
                    />
                    <Item
                        title="HMS Core"
                        detail={native ? packageDetail(native.hmsCore.installed, native.hmsCore.versionName) : 'N/A'}
                    />
                    <Item
                        title="Direct Huawei SDK result"
                        detail={result ? STATE_LABELS[result.state] : 'Unknown'}
                    />
                </ItemGroup>
            </ItemList>
        </>
    );
}
