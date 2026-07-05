export interface OtaGitInfo {
    sha?: string;
    branch?: string;
    subject?: string;
    dirty?: boolean;
}

export interface OtaDisplayInfo {
    title?: string;
    message?: string;
    source?: {
        type?: string;
        number?: string;
        url?: string;
    };
}

export interface OtaVersion {
    stamp: string;
    id: string;
    createdAt: string;
    channel: string;
    git: OtaGitInfo;
    display?: OtaDisplayInfo;
}

export interface OtaVersionSummary {
    title: string;
    subtitle: string;
    message?: string;
}

export interface OtaVersionCalendarParts {
    month: string;
    day: string;
    time: string;
}

export function extractOtaKeys(xml: string): string[] {
    const keys: string[] = [];
    const re = /<Key>([^<]+)<\/Key>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
        keys.push(match[1]);
    }
    return keys;
}

export function listOtaStamps(keys: string[], prefix: string): string[] {
    const stamps = new Set<string>();
    for (const key of keys) {
        if (!key.startsWith(prefix) || !key.endsWith('.json')) continue;
        const stamp = key.slice(prefix.length).replace(/\.json$/, '');
        if (!/^\d+$/.test(stamp)) continue;
        stamps.add(stamp);
    }
    return Array.from(stamps).sort((a, b) => Number(b) - Number(a));
}

export function getOtaVersionDate(version: OtaVersion): Date | null {
    const date = version.createdAt
        ? new Date(version.createdAt)
        : (/^\d+$/.test(version.stamp) ? new Date(Number(version.stamp)) : new Date(version.stamp));

    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatOtaVersionDateTime(version: OtaVersion): string {
    const date = getOtaVersionDate(version);
    return date ? date.toLocaleString() : version.stamp;
}

export function formatOtaVersionCompactDate(version: OtaVersion): string {
    const date = getOtaVersionDate(version);
    if (!date) return version.stamp;

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${month}/${day} · ${time}`;
}

export function formatOtaVersionCalendarParts(version: OtaVersion): OtaVersionCalendarParts {
    const date = getOtaVersionDate(version);
    if (!date) {
        return {
            month: 'UNK',
            day: '--',
            time: version.stamp,
        };
    }

    return {
        month: date.toLocaleString(undefined, { month: 'short' }).toUpperCase(),
        day: date.toLocaleString(undefined, { day: '2-digit' }),
        time: date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    };
}

export function formatOtaVersionSummary(version: OtaVersion): OtaVersionSummary {
    const sha = version.git?.sha ? `${version.git.sha}${version.git.dirty ? '*' : ''}` : version.id.slice(0, 8);
    const when = formatOtaVersionDateTime(version);
    const branch = version.git?.branch ? ` · ${version.git.branch}` : '';
    const title = version.display?.title || version.git?.subject || `(无 commit 信息) ${version.id.slice(0, 8)}`;
    const source = version.display?.source?.number ? `PR #${version.display.source.number} · ` : '';
    const commitSubject = version.display?.title && version.git?.subject ? `${version.git.subject} · ` : '';

    return {
        title,
        subtitle: `${source}${commitSubject}${sha}${branch} · ${when}`,
        message: version.display?.message,
    };
}

export function buildOtaVersionNotes(version: OtaVersion): string {
    const message = version.display?.message?.trim();
    if (message) return message;

    const subject = version.git?.subject?.trim();
    if (subject) return `> ${subject}`;

    return '_该版本没有记录发布说明。_';
}

export function buildOtaVersionPreview(version: OtaVersion, maxLength: number = 160): string {
    const raw = version.display?.message?.trim() || version.git?.subject?.trim() || version.id.slice(0, 8);
    const normalized = raw
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[`*_>#]/g, '')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
        : normalized;
}

export function formatOtaVersionCommit(version: OtaVersion): string {
    return version.git?.sha ? `${version.git.sha}${version.git.dirty ? '*' : ''}` : version.id.slice(0, 8);
}
