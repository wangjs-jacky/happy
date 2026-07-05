import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

export interface CodexUsageTokenTotals {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
}

export interface CodexUsageDay extends CodexUsageTokenTotals {
    date: string;
    tokenCountEvents: number;
    sessions: number;
    totalOnlyTokens: number;
}

export interface CodexUsageRateLimitWindow {
    usedPercent?: number;
    windowMinutes?: number;
    resetsAt?: number;
}

export interface CodexUsageRateLimits {
    planType?: string;
    primary?: CodexUsageRateLimitWindow;
    secondary?: CodexUsageRateLimitWindow;
    rateLimitReachedType?: string | null;
}

export interface CodexUsageSnapshot {
    source: 'codex-session-jsonl';
    codexHome: string;
    sessionsDir: string;
    timeZone: string;
    scannedAt: number;
    today: CodexUsageDay | null;
    yesterday: CodexUsageDay | null;
    days: CodexUsageDay[];
    latestEvent: {
        timestamp: string;
        localDate: string;
        lastTokenUsage: CodexUsageTokenTotals;
        sessionTotalTokenUsage?: CodexUsageTokenTotals;
        rateLimits?: CodexUsageRateLimits;
    } | null;
    warnings: string[];
}

interface CollectCodexUsageOptions {
    codexHome?: string;
    now?: Date;
    timeZone?: string;
    maxDays?: number;
}

interface SessionUsageAccumulator extends CodexUsageDay {
    sessionFiles: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    return typeof value === 'number' ? value : undefined;
}

function tokenTotalsFromJson(usage: unknown): CodexUsageTokenTotals | null {
    if (!isRecord(usage)) {
        return null;
    }
    return {
        inputTokens: numberField(usage, 'input_tokens') || 0,
        cachedInputTokens: numberField(usage, 'cached_input_tokens') || 0,
        outputTokens: numberField(usage, 'output_tokens') || 0,
        reasoningOutputTokens: numberField(usage, 'reasoning_output_tokens') || 0,
        totalTokens: numberField(usage, 'total_tokens') || 0,
    };
}

function emptyUsageDay(date: string): SessionUsageAccumulator {
    return {
        date,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        tokenCountEvents: 0,
        sessions: 0,
        totalOnlyTokens: 0,
        sessionFiles: new Set<string>(),
    };
}

function localDateKey(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date).reduce<Record<string, string>>((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function getTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

async function walkJsonlFiles(directory: string, warnings: string[]): Promise<string[]> {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
        if (code !== 'ENOENT') {
            warnings.push(`Failed to read ${directory}: ${error instanceof Error ? error.message : String(error)}`);
        }
        return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walkJsonlFiles(fullPath, warnings));
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            files.push(fullPath);
        }
    }
    return files;
}

function addUsage(day: SessionUsageAccumulator, usage: CodexUsageTokenTotals, filePath: string): void {
    day.inputTokens += usage.inputTokens;
    day.cachedInputTokens += usage.cachedInputTokens;
    day.outputTokens += usage.outputTokens;
    day.reasoningOutputTokens += usage.reasoningOutputTokens;
    day.totalTokens += usage.totalTokens;
    day.tokenCountEvents += 1;
    day.sessionFiles.add(filePath);

    const splitTotal = usage.inputTokens + usage.outputTokens;
    if (splitTotal === 0 && usage.totalTokens > 0) {
        day.totalOnlyTokens += usage.totalTokens;
    }
}

function toUsageDay(day: SessionUsageAccumulator): CodexUsageDay {
    return {
        date: day.date,
        inputTokens: day.inputTokens,
        cachedInputTokens: day.cachedInputTokens,
        outputTokens: day.outputTokens,
        reasoningOutputTokens: day.reasoningOutputTokens,
        totalTokens: day.totalTokens,
        tokenCountEvents: day.tokenCountEvents,
        sessions: day.sessionFiles.size,
        totalOnlyTokens: day.totalOnlyTokens,
    };
}

function toRateLimitWindow(value: unknown): CodexUsageRateLimitWindow | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    return {
        usedPercent: numberField(value, 'used_percent'),
        windowMinutes: numberField(value, 'window_minutes'),
        resetsAt: numberField(value, 'resets_at'),
    };
}

function toRateLimits(rateLimits: unknown): CodexUsageRateLimits | undefined {
    if (!isRecord(rateLimits)) {
        return undefined;
    }
    return {
        planType: typeof rateLimits.plan_type === 'string' ? rateLimits.plan_type : undefined,
        primary: toRateLimitWindow(rateLimits.primary),
        secondary: toRateLimitWindow(rateLimits.secondary),
        rateLimitReachedType: typeof rateLimits.rate_limit_reached_type === 'string' || rateLimits.rate_limit_reached_type === null
            ? rateLimits.rate_limit_reached_type
            : undefined,
    };
}

export async function collectCodexUsageSnapshot(options: CollectCodexUsageOptions = {}): Promise<CodexUsageSnapshot> {
    const now = options.now || new Date();
    const timeZone = options.timeZone || getTimeZone();
    const codexHome = options.codexHome || process.env.CODEX_HOME || join(os.homedir(), '.codex');
    const sessionsDir = join(codexHome, 'sessions');
    const maxDays = options.maxDays ?? 14;
    const warnings: string[] = [];
    const files = await walkJsonlFiles(sessionsDir, warnings);
    const byDate = new Map<string, SessionUsageAccumulator>();
    const todayKey = localDateKey(now, timeZone);
    const yesterdayKey = localDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone);
    let latestEvent: CodexUsageSnapshot['latestEvent'] = null;
    let latestEventTime = 0;

    for (const filePath of files) {
        let text = '';
        try {
            text = await readFile(filePath, 'utf8');
        } catch (error) {
            warnings.push(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }

        for (const line of text.split('\n')) {
            if (!line.trim()) {
                continue;
            }

            let record: unknown;
            try {
                record = JSON.parse(line);
            } catch {
                continue;
            }
            if (!isRecord(record) || record.type !== 'event_msg' || !isRecord(record.payload) || record.payload.type !== 'token_count') {
                continue;
            }

            const timestamp = typeof record.timestamp === 'string' ? record.timestamp : null;
            if (!timestamp) {
                continue;
            }

            const date = new Date(timestamp);
            const eventTime = date.getTime();
            if (!Number.isFinite(eventTime)) {
                continue;
            }

            const info = isRecord(record.payload.info) ? record.payload.info : {};
            const lastTokenUsage = tokenTotalsFromJson(info.last_token_usage);
            if (!lastTokenUsage) {
                continue;
            }

            const dateKey = localDateKey(date, timeZone);
            const day = byDate.get(dateKey) || emptyUsageDay(dateKey);
            addUsage(day, lastTokenUsage, filePath);
            byDate.set(dateKey, day);

            if (eventTime > latestEventTime) {
                latestEventTime = eventTime;
                latestEvent = {
                    timestamp,
                    localDate: dateKey,
                    lastTokenUsage,
                    sessionTotalTokenUsage: tokenTotalsFromJson(info.total_token_usage) || undefined,
                    rateLimits: toRateLimits(record.payload.rate_limits),
                };
            }
        }
    }

    const days = [...byDate.values()]
        .map(toUsageDay)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-maxDays);

    return {
        source: 'codex-session-jsonl',
        codexHome,
        sessionsDir,
        timeZone,
        scannedAt: now.getTime(),
        today: days.find(day => day.date === todayKey) || null,
        yesterday: days.find(day => day.date === yesterdayKey) || null,
        days,
        latestEvent,
        warnings,
    };
}

export function codexUsageSignature(snapshot: CodexUsageSnapshot): string {
    return JSON.stringify({
        today: snapshot.today,
        yesterday: snapshot.yesterday,
        latestEvent: snapshot.latestEvent,
        warnings: snapshot.warnings,
    });
}
