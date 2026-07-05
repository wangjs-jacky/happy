import { buildOtaVersionNotes, buildOtaVersionPreview, formatOtaVersionSummary, getOtaVersionDate, type OtaVersion } from '@/utils/otaVersions';
import { ChangelogEntry } from './types';

function formatHeadlineDate(version: OtaVersion): string {
    const date = getOtaVersionDate(version);
    if (!date) return '';

    const month = date.toLocaleString(undefined, { month: 'long' });
    return `${month} ${date.getDate()}`;
}

export function getOtaChangelogTitle(version: OtaVersion): string {
    const summary = formatOtaVersionSummary(version);
    const date = formatHeadlineDate(version);

    return date ? `${date} — ${summary.title}` : summary.title;
}

export function getOtaChangelogEntry(version: OtaVersion): ChangelogEntry {
    const summary = formatOtaVersionSummary(version);
    const preview = buildOtaVersionPreview(version, 220);
    const metadata = `> ${summary.subtitle}`;
    const notes = buildOtaVersionNotes(version);
    const sourceUrl = version.display?.source?.url;

    return {
        title: getOtaChangelogTitle(version),
        summary: preview !== summary.title ? preview : summary.subtitle,
        markdown: `${metadata}\n\n${notes}${sourceUrl ? `\n\n[Open PR](${sourceUrl})` : ''}`,
    };
}
