import type { OtaVersion } from './useOtaVersions';

export interface OtaVersionLine {
    title: string;
    subtitle: string;
    message?: string;
    updateIdShort: string;
}

export interface OtaVersionState {
    isRunning: boolean;
    isLocked: boolean;
}

export function compactOtaMessage(message: string | undefined, maxLength: number = 500): string {
    if (!message) {
        return '';
    }
    const compact = message.replace(/\n{3,}/g, '\n\n').trim();
    return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

export function formatOtaVersionLine(
    v: OtaVersion,
    options: {
        noCommitInfo?: (id: string) => string;
        formatDate?: (createdAt: string) => string;
    } = {},
): OtaVersionLine {
    const updateIdShort = v.id.slice(0, 8);
    const sha = v.git?.sha ? `${v.git.sha}${v.git.dirty ? '*' : ''}` : updateIdShort;
    const when = v.createdAt
        ? (options.formatDate ? options.formatDate(v.createdAt) : new Date(v.createdAt).toLocaleString())
        : v.stamp;
    const branch = v.git?.branch ? ` · ${v.git.branch}` : '';
    const title = v.display?.title || v.git?.subject || (options.noCommitInfo ? options.noCommitInfo(updateIdShort) : `(no commit info) ${updateIdShort}`);
    const source = v.display?.source?.number ? `PR #${v.display.source.number} · ` : '';
    const commitSubject = v.display?.title && v.git?.subject ? `${v.git.subject} · ` : '';
    return {
        title,
        subtitle: `${source}${commitSubject}${sha}${branch} · ${when}`,
        message: v.display?.message,
        updateIdShort,
    };
}

export function getRecommendedOtaVersion(versions: OtaVersion[]): OtaVersion | null {
    return versions[0] ?? null;
}

export function getOtaVersionState(
    v: OtaVersion,
    currentUpdateId: string | null | undefined,
    lockedStamp: string | null | undefined,
): OtaVersionState {
    return {
        isRunning: !!currentUpdateId && v.id === currentUpdateId,
        isLocked: v.stamp === lockedStamp,
    };
}
