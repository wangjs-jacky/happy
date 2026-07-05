import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { collectCodexUsageSnapshot } from './codexUsage';

function writeJsonl(filePath: string, rows: unknown[]): void {
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n'), 'utf8');
}

function tokenCount(timestamp: string, lastTokenUsage: Record<string, number>, rateLimits?: unknown): unknown {
    return {
        timestamp,
        type: 'event_msg',
        payload: {
            type: 'token_count',
            info: {
                last_token_usage: lastTokenUsage,
                total_token_usage: lastTokenUsage,
            },
            rate_limits: rateLimits,
        },
    };
}

describe('collectCodexUsageSnapshot', () => {
    const created: string[] = [];

    afterEach(() => {
        for (const dir of created.splice(0)) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('aggregates token_count events by local day', async () => {
        const codexHome = mkdtempSync(join(tmpdir(), 'codex-usage-home-'));
        created.push(codexHome);

        writeJsonl(join(codexHome, 'sessions', '2026', '07', '05', 'rollout.jsonl'), [
            { timestamp: '2026-07-04T15:59:00.000Z', type: 'event_msg', payload: { type: 'not_token_count' } },
            tokenCount('2026-07-04T16:30:00.000Z', {
                input_tokens: 100,
                cached_input_tokens: 40,
                output_tokens: 20,
                reasoning_output_tokens: 5,
                total_tokens: 120,
            }),
            tokenCount('2026-07-05T08:00:00.000Z', {
                input_tokens: 10,
                cached_input_tokens: 2,
                output_tokens: 3,
                reasoning_output_tokens: 1,
                total_tokens: 13,
            }, {
                plan_type: 'pro',
                primary: { used_percent: 25, window_minutes: 300, resets_at: 1783167726 },
                secondary: { used_percent: 44, window_minutes: 10080, resets_at: 1783414235 },
                rate_limit_reached_type: null,
            }),
        ]);

        const snapshot = await collectCodexUsageSnapshot({
            codexHome,
            now: new Date('2026-07-06T01:00:00.000+08:00'),
            timeZone: 'Asia/Shanghai',
        });

        expect(snapshot.yesterday).toMatchObject({
            date: '2026-07-05',
            inputTokens: 110,
            cachedInputTokens: 42,
            outputTokens: 23,
            reasoningOutputTokens: 6,
            totalTokens: 133,
            tokenCountEvents: 2,
            sessions: 1,
        });
        expect(snapshot.latestEvent?.rateLimits?.primary?.usedPercent).toBe(25);
    });

    it('keeps total-only Codex events in the total token count', async () => {
        const codexHome = mkdtempSync(join(tmpdir(), 'codex-usage-home-'));
        created.push(codexHome);

        writeJsonl(join(codexHome, 'sessions', '2026', '07', '05', 'rollout.jsonl'), [
            tokenCount('2026-07-05T05:00:00.000Z', {
                input_tokens: 0,
                cached_input_tokens: 0,
                output_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 398182,
            }),
        ]);

        const snapshot = await collectCodexUsageSnapshot({
            codexHome,
            now: new Date('2026-07-06T01:00:00.000+08:00'),
            timeZone: 'Asia/Shanghai',
        });

        expect(snapshot.yesterday?.totalTokens).toBe(398182);
        expect(snapshot.yesterday?.totalOnlyTokens).toBe(398182);
    });
});
