import { describe, expect, it } from 'vitest';
import {
    buildOtaVersionPreview,
    buildOtaVersionNotes,
    extractOtaKeys,
    formatOtaVersionCompactDate,
    formatOtaVersionCalendarParts,
    formatOtaVersionCommit,
    formatOtaVersionSummary,
    listOtaStamps,
    type OtaVersion,
} from './otaVersions';

describe('otaVersions utils', () => {
    it('extracts object keys from oss xml', () => {
        expect(extractOtaKeys(`
            <ListBucketResult>
                <Contents><Key>meta/android/21/preview/200.json</Key></Contents>
                <Contents><Key>meta/android/21/preview/100.json</Key></Contents>
            </ListBucketResult>
        `)).toEqual([
            'meta/android/21/preview/200.json',
            'meta/android/21/preview/100.json',
        ]);
    });

    it('filters, deduplicates, and sorts ota stamps', () => {
        expect(listOtaStamps([
            'meta/android/21/preview/100.json',
            'meta/android/21/preview/200.json',
            'meta/android/21/preview/not-a-stamp.json',
            'meta/android/21/production/300.json',
            'meta/android/21/preview/200.json',
        ], 'meta/android/21/preview/')).toEqual(['200', '100']);
    });

    it('formats display metadata ahead of raw commit info', () => {
        const version: OtaVersion = {
            stamp: '1720000000000',
            id: '1234567890abcdef',
            createdAt: '',
            channel: 'preview',
            git: {
                sha: 'abcdef12',
                branch: 'feat/ota',
                subject: 'fix(app): tighten ota flow',
                dirty: true,
            },
            display: {
                title: 'fix(app): show delete issues',
                message: '## Notes\n\nFull release note',
                source: {
                    number: '84',
                },
            },
        };

        const summary = formatOtaVersionSummary(version);
        expect(summary.title).toBe('fix(app): show delete issues');
        expect(summary.message).toBe('## Notes\n\nFull release note');
        expect(summary.subtitle).toContain('PR #84 · fix(app): tighten ota flow · abcdef12* · feat/ota · ');
    });

    it('falls back to commit subject and id when display metadata is missing', () => {
        const version: OtaVersion = {
            stamp: '1720000000000',
            id: '1234567890abcdef',
            createdAt: '',
            channel: 'preview',
            git: {
                subject: 'fix(app): fallback title',
            },
        };

        const summary = formatOtaVersionSummary(version);
        expect(summary.title).toBe('fix(app): fallback title');
        expect(summary.subtitle).toContain('12345678 · ');
        expect(summary.message).toBeUndefined();
        expect(buildOtaVersionNotes(version)).toBe('> fix(app): fallback title');
        expect(formatOtaVersionCommit(version)).toBe('12345678');
    });

    it('builds a compact preview from markdown release notes', () => {
        const version: OtaVersion = {
            stamp: '1720000000000',
            id: '1234567890abcdef',
            createdAt: '',
            channel: 'preview',
            git: {},
            display: {
                message: '## Title\n\n- Ship [preview](https://example.com)\n- Remove `legacy` state',
            },
        };

        expect(buildOtaVersionPreview(version)).toBe('Title - Ship preview - Remove legacy state');
    });

    it('derives month/day/time parts for timeline rendering', () => {
        const version: OtaVersion = {
            stamp: '1720000000000',
            id: '1234567890abcdef',
            createdAt: '2024-07-03T09:46:40.000Z',
            channel: 'preview',
            git: {},
        };

        const parts = formatOtaVersionCalendarParts(version);
        expect(parts.month).toHaveLength(3);
        expect(parts.day).toHaveLength(2);
        expect(parts.time.length).toBeGreaterThanOrEqual(4);
    });

    it('formats a compact numeric date for list rows', () => {
        const version: OtaVersion = {
            stamp: '1720000000000',
            id: '1234567890abcdef',
            createdAt: '2024-07-03T09:46:40.000Z',
            channel: 'preview',
            git: {},
        };

        expect(formatOtaVersionCompactDate(version)).toMatch(/^\d{2}\/\d{2} · /);
    });
});
