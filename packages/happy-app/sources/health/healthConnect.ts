import { Platform } from 'react-native';
import {
    getGrantedPermissions,
    getSdkStatus,
    initialize,
    openHealthConnectSettings,
    readRecords,
    requestPermission,
    SdkAvailabilityStatus,
    type Permission,
} from 'react-native-health-connect';
import {
    healthLogFromHealthConnectSleep,
    summarizeHeartRateRecords,
    summarizeSleepSessions,
    type HeartRateSummary,
    type SleepSummary,
} from './healthConnectModel';
import type { HealthLog } from '@/utils/healthLog';

const READ_PERMISSIONS: Permission[] = [
    { accessType: 'read', recordType: 'SleepSession' },
    { accessType: 'read', recordType: 'HeartRate' },
];

export type HealthConnectState =
    | 'unsupported-platform'
    | 'sdk-unavailable'
    | 'provider-update-required'
    | 'permissions-required'
    | 'ready';

export interface HealthConnectSnapshot {
    state: HealthConnectState;
    initialized: boolean;
    permissions: {
        sleep: boolean;
        heartRate: boolean;
    };
    range: {
        startTime: string;
        endTime: string;
    };
    sleep: SleepSummary;
    heartRate: HeartRateSummary;
    healthLog: HealthLog;
}

function hasReadPermission(
    permissions: Permission[],
    recordType: Permission['recordType'],
): boolean {
    return permissions.some(
        (permission) =>
            permission.accessType === 'read' && permission.recordType === recordType,
    );
}

function emptySnapshot(
    state: HealthConnectState,
    startTime: string,
    endTime: string,
): HealthConnectSnapshot {
    const sleep = summarizeSleepSessions([]);
    return {
        state,
        initialized: false,
        permissions: { sleep: false, heartRate: false },
        range: { startTime, endTime },
        sleep,
        heartRate: summarizeHeartRateRecords([]),
        healthLog: healthLogFromHealthConnectSleep(endTime.slice(0, 10), sleep),
    };
}

export async function getHealthConnectSnapshot(options?: {
    requestMissingPermissions?: boolean;
    startTime?: string;
    endTime?: string;
}): Promise<HealthConnectSnapshot> {
    const endTime = options?.endTime ?? new Date().toISOString();
    const startTime =
        options?.startTime ??
        new Date(new Date(endTime).getTime() - 48 * 60 * 60 * 1_000).toISOString();

    if (Platform.OS !== 'android') {
        return emptySnapshot('unsupported-platform', startTime, endTime);
    }

    const sdkStatus = await getSdkStatus();
    if (sdkStatus === SdkAvailabilityStatus.SDK_UNAVAILABLE) {
        return emptySnapshot('sdk-unavailable', startTime, endTime);
    }
    if (
        sdkStatus ===
        SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
    ) {
        return emptySnapshot('provider-update-required', startTime, endTime);
    }

    const initialized = await initialize();
    let granted = (await getGrantedPermissions()) as Permission[];
    if (options?.requestMissingPermissions) {
        granted = (await requestPermission(READ_PERMISSIONS)) as Permission[];
    }

    const sleepPermission = hasReadPermission(granted, 'SleepSession');
    const heartRatePermission = hasReadPermission(granted, 'HeartRate');
    if (!sleepPermission && !heartRatePermission) {
        return {
            ...emptySnapshot('permissions-required', startTime, endTime),
            initialized,
        };
    }

    const timeRangeFilter = {
        operator: 'between' as const,
        startTime,
        endTime,
    };
    const [sleepResult, heartRateResult] = await Promise.all([
        sleepPermission
            ? readRecords('SleepSession', { timeRangeFilter, pageSize: 1_000 })
            : Promise.resolve({ records: [] }),
        heartRatePermission
            ? readRecords('HeartRate', { timeRangeFilter, pageSize: 1_000 })
            : Promise.resolve({ records: [] }),
    ]);

    const sleep = summarizeSleepSessions(
        sleepResult.records.map((record) => ({
            ...record,
            dataOrigin: record.metadata?.dataOrigin,
        })),
    );
    const heartRate = summarizeHeartRateRecords(
        heartRateResult.records.map((record) => ({
            ...record,
            dataOrigin: record.metadata?.dataOrigin,
        })),
    );

    return {
        state:
            sleepPermission && heartRatePermission ? 'ready' : 'permissions-required',
        initialized,
        permissions: {
            sleep: sleepPermission,
            heartRate: heartRatePermission,
        },
        range: { startTime, endTime },
        sleep,
        heartRate,
        healthLog: healthLogFromHealthConnectSleep(endTime.slice(0, 10), sleep),
    };
}

export function showHealthConnectSettings(): void {
    if (Platform.OS === 'android') {
        openHealthConnectSettings();
    }
}
