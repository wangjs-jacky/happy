import type { Message } from '@/sync/typesMessage';

const PREVIEW_SITE_URL = 'https://wangjs-jacky.github.io/happy-ota-site/';
const OTA_TAG = 'happy-ota-preview';
const BLOCK_REGEX = new RegExp(`<${OTA_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${OTA_TAG}>`, 'gi');
const URL_REGEX = /https?:\/\/[^\s)]+/i;

export type SessionOtaPreview = {
    id: string;
    messageId: string;
    source: 'block' | 'legacy';
    title: string;
    channel: string | null;
    platform: string | null;
    runtimeVersion: string | null;
    updateId: string | null;
    stamp: string | null;
    manifestUrl: string | null;
    sourceUrl: string | null;
    siteUrl: string | null;
    summary: string | null;
    raw: string;
};

export type OtaPreviewPrimaryAction =
    | { type: 'current' }
    | { type: 'switch'; stamp: string }
    | { type: 'link'; url: string }
    | null;

type OtaPreviewPrimaryActionOptions = {
    currentUpdateId?: string | null;
    currentUpdateIds?: readonly (string | null | undefined)[];
    runtimeChannel?: string | null;
};

type ParsedFields = {
    title?: string;
    channel?: string;
    platform?: string;
    runtimeVersion?: string;
    updateId?: string;
    stamp?: string;
    manifestUrl?: string;
    sourceUrl?: string;
    siteUrl?: string;
    summary?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function parseManifestRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string') {
        try {
            return asRecord(JSON.parse(value));
        } catch {
            return null;
        }
    }
    return asRecord(value);
}

function addUpdateId(ids: string[], value: unknown) {
    if (typeof value !== 'string') return;
    const id = value.trim();
    if (id && !ids.includes(id)) {
        ids.push(id);
    }
}

function stripMarkdown(value: string): string {
    return value
        .replace(/^\s*[-*•]\s*/, '')
        .replace(/^>\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .trim();
}

function normalizeKey(rawKey: string): keyof ParsedFields | null {
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    switch (key) {
        case 'title':
            return 'title';
        case 'channel':
            return 'channel';
        case 'platform':
            return 'platform';
        case 'runtimeversion':
            return 'runtimeVersion';
        case 'updateid':
            return 'updateId';
        case 'stamp':
            return 'stamp';
        case 'manifest':
        case 'manifesturl':
            return 'manifestUrl';
        case 'sourceurl':
        case 'prurl':
            return 'sourceUrl';
        case 'siteurl':
        case 'previewsite':
            return 'siteUrl';
        case 'summary':
        case 'notes':
        case 'message':
            return 'summary';
        default:
            return null;
    }
}

function extractStamp(manifestUrl: string | undefined): string | null {
    if (!manifestUrl) return null;
    const match = manifestUrl.match(/\/(\d+)\.json(?:\?|#|$)/);
    return match?.[1] ?? null;
}

function isPreviewChannelName(channel: string | null | undefined): boolean {
    return channel?.trim().toLowerCase() === 'preview';
}

function findSourceUrl(text: string): string | null {
    const links = Array.from(text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi));
    const preferredMarkdown = links.find((match) => /pr|pull/i.test(match[1]) || /\/pull\//i.test(match[2]));
    if (preferredMarkdown) {
        return preferredMarkdown[2];
    }

    const plainLinks = Array.from(text.matchAll(/https?:\/\/\S+/gi)).map((match) => match[0].replace(/[),.;!?]+$/, ''));
    const preferredPlain = plainLinks.find((url) => /github\.com\/.+\/pull\//i.test(url));
    return preferredPlain ?? null;
}

function buildPreview(
    fields: ParsedFields,
    raw: string,
    messageId: string,
    index: number,
    source: SessionOtaPreview['source'],
): SessionOtaPreview | null {
    const channel = fields.channel?.trim() ?? null;
    const platform = fields.platform?.trim() ?? null;
    const runtimeVersion = fields.runtimeVersion?.trim() ?? null;
    const updateId = fields.updateId?.trim() ?? null;
    const manifestUrl = fields.manifestUrl?.trim() ?? null;

    if (!channel || !platform || !runtimeVersion || !updateId || !manifestUrl) {
        return null;
    }

    const summary = fields.summary?.trim() ?? null;
    const title = fields.title?.trim()
        || (channel === 'preview' ? 'Preview OTA' : 'OTA Release');
    const sourceUrl = fields.sourceUrl?.trim() || findSourceUrl(raw);
    const siteUrl = fields.siteUrl?.trim() || (channel === 'preview' ? PREVIEW_SITE_URL : null);
    const stamp = fields.stamp?.trim() || extractStamp(manifestUrl);

    return {
        id: `${messageId}:${source}:${index}`,
        messageId,
        source,
        title,
        channel,
        platform,
        runtimeVersion,
        updateId,
        stamp,
        manifestUrl,
        sourceUrl,
        siteUrl,
        summary,
        raw: raw.trim(),
    };
}

function parseFieldSection(
    section: string,
    messageId: string,
    index: number,
    source: SessionOtaPreview['source'],
): SessionOtaPreview | null {
    const fields: ParsedFields = {};
    let currentKey: keyof ParsedFields | null = null;

    for (const rawLine of section.split(/\r?\n/)) {
        const line = stripMarkdown(rawLine);
        if (!line) {
            currentKey = null;
            continue;
        }

        const match = line.match(/^([A-Za-z][A-Za-z0-9 _-]*):\s*(.*)$/);
        if (match) {
            const key = normalizeKey(match[1]);
            if (!key) {
                currentKey = null;
                continue;
            }
            fields[key] = stripMarkdown(match[2]);
            currentKey = key;
            continue;
        }

        if (currentKey) {
            const nextValue = stripMarkdown(line);
            fields[currentKey] = fields[currentKey]
                ? `${fields[currentKey]}\n${nextValue}`
                : nextValue;
        }
    }

    return buildPreview(fields, section, messageId, index, source);
}

function extractTaggedPreviews(text: string, messageId: string): SessionOtaPreview[] {
    const previews: SessionOtaPreview[] = [];
    let match: RegExpExecArray | null;

    while ((match = BLOCK_REGEX.exec(text)) !== null) {
        const preview = parseFieldSection(match[1], messageId, previews.length, 'block');
        if (preview) {
            previews.push(preview);
        }
    }

    return previews;
}

function findLegacyTitle(lines: string[], startIndex: number): string | undefined {
    for (let index = startIndex - 1; index >= 0 && index >= startIndex - 3; index -= 1) {
        const line = stripMarkdown(lines[index]);
        if (!line) continue;
        if (/ota/i.test(line)) {
            return line.replace(/^#+\s*/, '').trim();
        }
    }
    return undefined;
}

function extractLegacyPreviews(text: string, messageId: string): SessionOtaPreview[] {
    const previews: SessionOtaPreview[] = [];
    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const line = stripMarkdown(lines[index]);
        if (!/^channel\s*:/i.test(line)) {
            continue;
        }

        const sectionLines = [lines[index]];
        for (let cursor = index + 1; cursor < lines.length && cursor < index + 12; cursor += 1) {
            const nextRaw = lines[cursor];
            const next = stripMarkdown(nextRaw);
            if (!next) {
                break;
            }
            sectionLines.push(nextRaw);
        }

        const title = findLegacyTitle(lines, index);
        const preview = parseFieldSection(
            title ? [`title: ${title}`, ...sectionLines].join('\n') : sectionLines.join('\n'),
            messageId,
            previews.length,
            'legacy',
        );

        if (preview) {
            previews.push(preview);
            index += sectionLines.length - 1;
        }
    }

    return previews;
}

export function extractMessageOtaPreviews(message: Message): SessionOtaPreview[] {
    if (message.kind !== 'agent-text' || message.isThinking) {
        return [];
    }

    const tagged = extractTaggedPreviews(message.text, message.id);
    if (tagged.length > 0) {
        return tagged;
    }

    return extractLegacyPreviews(message.text, message.id);
}

export function extractSessionOtaPreviews(messages: Message[]): SessionOtaPreview[] {
    const previews: SessionOtaPreview[] = [];
    for (const message of messages) {
        previews.push(...extractMessageOtaPreviews(message));
    }
    return previews;
}

export function parseOtaPreviewSection(
    section: string,
    options?: {
        source?: SessionOtaPreview['source'];
        messageId?: string;
        index?: number;
    }
): SessionOtaPreview | null {
    return parseFieldSection(
        section,
        options?.messageId ?? 'inline',
        options?.index ?? 0,
        options?.source ?? 'block',
    );
}

export function getOtaPreviewPrimaryLink(preview: SessionOtaPreview): string | null {
    return preview.sourceUrl ?? preview.siteUrl ?? preview.manifestUrl;
}

export function getOtaPreviewSwitchStamp(preview: SessionOtaPreview): string | null {
    const stamp = preview.stamp?.trim();
    if (preview.channel !== 'preview' || !stamp || !/^\d+$/.test(stamp)) {
        return null;
    }
    return stamp;
}

export function getOtaPreviewCurrentUpdateIds(input: {
    updateId?: string | null;
    manifest?: unknown;
}): string[] {
    const ids: string[] = [];
    addUpdateId(ids, input.updateId);

    const manifest = parseManifestRecord(input.manifest);
    addUpdateId(ids, manifest?.id);

    const extra = asRecord(manifest?.extra);
    const otaTarget = asRecord(extra?.otaTarget);
    addUpdateId(ids, otaTarget?.virtualUpdateId);
    addUpdateId(ids, otaTarget?.originalUpdateId);

    return ids;
}

export function getOtaPreviewPrimaryAction(
    preview: SessionOtaPreview,
    options?: OtaPreviewPrimaryActionOptions,
): OtaPreviewPrimaryAction {
    const currentUpdateIds = new Set<string>();
    const addCurrentUpdateId = (value: unknown) => {
        if (typeof value !== 'string') return;
        const id = value.trim();
        if (id) {
            currentUpdateIds.add(id);
        }
    };

    addCurrentUpdateId(options?.currentUpdateId);
    for (const id of options?.currentUpdateIds ?? []) {
        addCurrentUpdateId(id);
    }

    if (preview.updateId && currentUpdateIds.has(preview.updateId.trim())) {
        return { type: 'current' };
    }

    const runtimeCanSwitch = options?.runtimeChannel === undefined
        ? true
        : isPreviewChannelName(options.runtimeChannel);
    const switchStamp = runtimeCanSwitch ? getOtaPreviewSwitchStamp(preview) : null;
    if (switchStamp) {
        return { type: 'switch', stamp: switchStamp };
    }

    const url = getOtaPreviewPrimaryLink(preview);
    return url ? { type: 'link', url } : null;
}

export function formatOtaPreviewLabel(preview: SessionOtaPreview): string {
    const parts = [preview.channel, preview.platform];
    if (preview.runtimeVersion) {
        parts.push(`runtime ${preview.runtimeVersion}`);
    }
    return parts.filter(Boolean).join(' · ');
}

export function formatOtaPreviewIdentity(preview: SessionOtaPreview): string {
    const parts = [
        preview.stamp ? `stamp ${preview.stamp}` : null,
        preview.updateId ? `update ${preview.updateId.slice(0, 8)}` : null,
    ];
    return parts.filter(Boolean).join(' · ');
}

export function isHappyOtaPreviewBlock(line: string): boolean {
    return line.trim().startsWith(`<${OTA_TAG}>`);
}

export function looksLikeOtaPreviewLegacyStart(line: string): boolean {
    return /^channel\s*:/i.test(stripMarkdown(line));
}

export function getOtaPreviewSiteUrl(): string {
    return PREVIEW_SITE_URL;
}

export function extractFirstUrl(line: string): string | null {
    return line.match(URL_REGEX)?.[0] ?? null;
}
