import { describe, expect, it } from 'vitest';
import {
    healthLogFromHealthConnectSleep,
    summarizeHeartRateRecords,
    summarizeSleepSessions,
} from './healthConnectModel';

describe('Health Connect model', () => {
    it('uses the longest sleep session as the main sleep and maps its stages', () => {
        const summary = summarizeSleepSessions([
            {
                startTime: '2026-07-26T14:00:00.000Z',
                endTime: '2026-07-26T14:30:00.000Z',
                dataOrigin: 'nl.appyhapps.healthsync',
            },
            {
                startTime: '2026-07-26T23:00:00.000Z',
                endTime: '2026-07-27T07:00:00.000Z',
                dataOrigin: 'nl.appyhapps.healthsync',
                stages: [
                    {
                        startTime: '2026-07-26T23:00:00.000Z',
                        endTime: '2026-07-27T01:00:00.000Z',
                        stage: 5,
                    },
                    {
                        startTime: '2026-07-27T01:00:00.000Z',
                        endTime: '2026-07-27T05:00:00.000Z',
                        stage: 4,
                    },
                    {
                        startTime: '2026-07-27T05:00:00.000Z',
                        endTime: '2026-07-27T07:00:00.000Z',
                        stage: 6,
                    },
                ],
            },
        ]);

        expect(summary).toMatchObject({
            sessionCount: 2,
            totalMinutes: 480,
            deepMinutes: 120,
            lightMinutes: 240,
            remMinutes: 120,
            napMinutes: 30,
            dataOrigins: ['nl.appyhapps.healthsync'],
        });
        expect(healthLogFromHealthConnectSleep('2026-07-27', summary)).toMatchObject({
            date: '2026-07-27',
            hasSleep: true,
            sleepTotalMin: 480,
            deepMin: 120,
            lightMin: 240,
            remMin: 120,
            napMin: 30,
        });
    });

    it('summarizes heart-rate samples chronologically', () => {
        expect(
            summarizeHeartRateRecords([
                {
                    dataOrigin: 'nl.appyhapps.healthsync',
                    samples: [
                        { time: '2026-07-27T08:00:00.000Z', beatsPerMinute: 80 },
                        { time: '2026-07-27T07:00:00.000Z', beatsPerMinute: 60 },
                        { time: '2026-07-27T09:00:00.000Z', beatsPerMinute: 70 },
                    ],
                },
            ]),
        ).toEqual({
            sampleCount: 3,
            averageBpm: 70,
            minimumBpm: 60,
            maximumBpm: 80,
            latestBpm: 70,
            latestTime: '2026-07-27T09:00:00.000Z',
            dataOrigins: ['nl.appyhapps.healthsync'],
        });
    });

    it('returns empty summaries when Health Connect has no records', () => {
        expect(summarizeSleepSessions([])).toMatchObject({
            sessionCount: 0,
            totalMinutes: null,
        });
        expect(summarizeHeartRateRecords([])).toMatchObject({
            sampleCount: 0,
            averageBpm: null,
            latestBpm: null,
        });
    });
});
