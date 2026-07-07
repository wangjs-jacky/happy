import { MMKV } from 'react-native-mmkv';
import type { OpenBirdPublishResult } from './openBirdSessionShare';

const mmkv = new MMKV();
const HISTORY_KEY_PREFIX = 'openbird-share-history-v1:';
const MAX_HISTORY_ENTRIES = 5;

export interface OpenBirdShareHistoryEntry {
    url: string;
    slug?: string;
    expiresAt?: string;
    sharedAt: number;
}

export function loadOpenBirdShareHistory(sessionId: string): OpenBirdShareHistoryEntry[] {
    const raw = mmkv.getString(getHistoryKey(sessionId));
    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .map(parseHistoryEntry)
            .filter((entry): entry is OpenBirdShareHistoryEntry => entry !== null)
            .sort((a, b) => b.sharedAt - a.sharedAt)
            .slice(0, MAX_HISTORY_ENTRIES);
    } catch {
        return [];
    }
}

export function loadLatestOpenBirdShare(sessionId: string): OpenBirdShareHistoryEntry | null {
    return loadOpenBirdShareHistory(sessionId)[0] ?? null;
}

export function rememberOpenBirdShare(
    sessionId: string,
    result: OpenBirdPublishResult & { sharedAt?: number },
): OpenBirdShareHistoryEntry {
    const entry: OpenBirdShareHistoryEntry = {
        url: result.url,
        ...(result.slug ? { slug: result.slug } : {}),
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
        sharedAt: result.sharedAt ?? Date.now(),
    };
    const history = [
        entry,
        ...loadOpenBirdShareHistory(sessionId).filter((item) => item.url !== entry.url),
    ].slice(0, MAX_HISTORY_ENTRIES);

    mmkv.set(getHistoryKey(sessionId), JSON.stringify(history));
    return entry;
}

function getHistoryKey(sessionId: string): string {
    return `${HISTORY_KEY_PREFIX}${sessionId}`;
}

function parseHistoryEntry(value: unknown): OpenBirdShareHistoryEntry | null {
    if (!isObject(value) || typeof value.url !== 'string' || value.url.length === 0) {
        return null;
    }
    return {
        url: value.url,
        ...(typeof value.slug === 'string' && value.slug.length > 0 ? { slug: value.slug } : {}),
        ...(typeof value.expiresAt === 'string' && value.expiresAt.length > 0 ? { expiresAt: value.expiresAt } : {}),
        sharedAt: typeof value.sharedAt === 'number' ? value.sharedAt : 0,
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
