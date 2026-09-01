import type { HealthLog } from '@/utils/healthLog';

export const HEALTH_CONNECT_SLEEP_STAGE = {
    awake: 1,
    sleeping: 2,
    outOfBed: 3,
    light: 4,
    deep: 5,
    rem: 6,
} as const;

export interface HealthConnectSleepStage {
    startTime: string;
    endTime: string;
    stage: number;
}

export interface HealthConnectSleepSession {
    startTime: string;
    endTime: string;
    stages?: HealthConnectSleepStage[];
    dataOrigin?: string;
}

export interface HealthConnectHeartRateSample {
    time: string;
    beatsPerMinute: number;
}

export interface HealthConnectHeartRateRecord {
    samples: HealthConnectHeartRateSample[];
    dataOrigin?: string;
}

export interface SleepSummary {
    sessionCount: number;
    mainStartTime: string | null;
    mainEndTime: string | null;
    totalMinutes: number | null;
    deepMinutes: number | null;
    lightMinutes: number | null;
    remMinutes: number | null;
    awakeMinutes: number | null;
    napMinutes: number | null;
    dataOrigins: string[];
}

export interface HeartRateSummary {
    sampleCount: number;
    averageBpm: number | null;
    minimumBpm: number | null;
    maximumBpm: number | null;
    latestBpm: number | null;
    latestTime: string | null;
    dataOrigins: string[];
}

function minutesBetween(startTime: string, endTime: string): number {
    const milliseconds = new Date(endTime).getTime() - new Date(startTime).getTime();
    return Math.max(0, Math.round(milliseconds / 60_000));
}

function sumStageMinutes(
    session: HealthConnectSleepSession,
    acceptedStages: ReadonlySet<number>,
): number | null {
    if (!session.stages?.length) return null;
    return session.stages.reduce(
        (total, stage) =>
            acceptedStages.has(stage.stage)
                ? total + minutesBetween(stage.startTime, stage.endTime)
                : total,
        0,
    );
}

const ASLEEP_STAGES = new Set([
    HEALTH_CONNECT_SLEEP_STAGE.sleeping,
    HEALTH_CONNECT_SLEEP_STAGE.light,
    HEALTH_CONNECT_SLEEP_STAGE.deep,
    HEALTH_CONNECT_SLEEP_STAGE.rem,
]);

function sessionAsleepMinutes(session: HealthConnectSleepSession): number {
    return (
        sumStageMinutes(session, ASLEEP_STAGES) ??
        minutesBetween(session.startTime, session.endTime)
    );
}

function uniqueOrigins(items: { dataOrigin?: string }[]): string[] {
    return [...new Set(items.map((item) => item.dataOrigin).filter(Boolean) as string[])];
}

export function summarizeSleepSessions(
    sessions: HealthConnectSleepSession[],
): SleepSummary {
    const sorted = [...sessions].sort(
        (left, right) => sessionAsleepMinutes(right) - sessionAsleepMinutes(left),
    );
    const main = sorted[0] ?? null;
    const stageMinutes = (stage: number) =>
        main ? sumStageMinutes(main, new Set([stage])) : null;

    return {
        sessionCount: sessions.length,
        mainStartTime: main?.startTime ?? null,
        mainEndTime: main?.endTime ?? null,
        totalMinutes: main ? sessionAsleepMinutes(main) : null,
        deepMinutes: stageMinutes(HEALTH_CONNECT_SLEEP_STAGE.deep),
        lightMinutes: stageMinutes(HEALTH_CONNECT_SLEEP_STAGE.light),
        remMinutes: stageMinutes(HEALTH_CONNECT_SLEEP_STAGE.rem),
        awakeMinutes: stageMinutes(HEALTH_CONNECT_SLEEP_STAGE.awake),
        napMinutes:
            sorted.length > 1
                ? sorted.slice(1).reduce(
                    (total, session) => total + sessionAsleepMinutes(session),
                    0,
                )
                : null,
        dataOrigins: uniqueOrigins(sessions),
    };
}

export function summarizeHeartRateRecords(
    records: HealthConnectHeartRateRecord[],
): HeartRateSummary {
    const samples = records
        .flatMap((record) => record.samples)
        .filter((sample) => Number.isFinite(sample.beatsPerMinute))
        .sort(
            (left, right) =>
                new Date(left.time).getTime() - new Date(right.time).getTime(),
        );
    const values = samples.map((sample) => sample.beatsPerMinute);
    const latest = samples.at(-1);

    return {
        sampleCount: samples.length,
        averageBpm: values.length
            ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
            : null,
        minimumBpm: values.length ? Math.min(...values) : null,
        maximumBpm: values.length ? Math.max(...values) : null,
        latestBpm: latest?.beatsPerMinute ?? null,
        latestTime: latest?.time ?? null,
        dataOrigins: uniqueOrigins(records),
    };
}

function localTime(isoTime: string | null): string | null {
    if (!isoTime) return null;
    return new Date(isoTime).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

export function healthLogFromHealthConnectSleep(
    date: string,
    sleep: SleepSummary,
): HealthLog {
    return {
        date,
        hasExercise: false,
        hasSleep: sleep.totalMinutes != null,
        hasDiet: false,
        sleepScore: null,
        sleepTotalMin: sleep.totalMinutes,
        deepMin: sleep.deepMinutes,
        lightMin: sleep.lightMinutes,
        remMin: sleep.remMinutes,
        napMin: sleep.napMinutes,
        sleepQuality: null,
        bedtime: localTime(sleep.mainStartTime),
        wakeTime: localTime(sleep.mainEndTime),
        exerciseTypes: [],
        exerciseBurn: null,
        meals: [],
        intakeKcal: null,
    };
}
