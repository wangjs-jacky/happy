import type { OpenBirdTranscriptEnvelope } from '@/utils/openBirdSessionEnvelope';

/**
 * OpenBird 通用 transcript 发布端点。app 侧把会话序列化成通用「transcript 信封」
 * POST 给 OpenBird，OpenBird 渲染成一份带 document / chat 双主题的临时网页
 * （1 小时过期），返回公开 URL。
 *
 * 契约见 openbird/docs/transcript-contract.md（唯一事实源）。
 */

export const OPENBIRD_API_BASE_URL = 'https://openbird.jhao.space';

export interface PublishOpenBirdTranscriptResult {
    slug?: string;
    url: string;
    title?: string;
    expiresAt?: string;
    ttlMinutes?: number;
    guest?: boolean;
}

export interface PublishOpenBirdTranscriptOptions {
    /** 覆盖默认 base url（本地 wrangler dev 时用）。 */
    apiBaseUrl?: string;
}

export async function publishOpenBirdTranscript(
    envelope: OpenBirdTranscriptEnvelope,
    options: PublishOpenBirdTranscriptOptions = {},
): Promise<PublishOpenBirdTranscriptResult> {
    const apiBaseUrl = (options.apiBaseUrl ?? OPENBIRD_API_BASE_URL).replace(/\/+$/, '');
    const response = await fetch(`${apiBaseUrl}/api/v1/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
    });

    const data = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
        throw new Error(readOpenBirdError(data) ?? `OpenBird publish failed (${response.status})`);
    }
    if (!isObject(data) || typeof data.url !== 'string' || data.url.length === 0) {
        throw new Error('OpenBird did not return a share URL.');
    }

    return {
        url: data.url,
        ...(typeof data.slug === 'string' ? { slug: data.slug } : {}),
        ...(typeof data.title === 'string' ? { title: data.title } : {}),
        ...(typeof data.expiresAt === 'string' ? { expiresAt: data.expiresAt } : {}),
        ...(typeof data.ttlMinutes === 'number' ? { ttlMinutes: data.ttlMinutes } : {}),
        ...(typeof data.guest === 'boolean' ? { guest: data.guest } : {}),
    };
}

function readOpenBirdError(data: unknown): string | null {
    if (isObject(data)) {
        if (typeof data.error === 'string' && data.error.length > 0) {
            return data.error;
        }
        if (typeof data.message === 'string' && data.message.length > 0) {
            return data.message;
        }
    }
    return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
