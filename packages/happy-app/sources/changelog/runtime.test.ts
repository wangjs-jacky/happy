import { describe, expect, it } from 'vitest';
import type { OtaVersion } from '@/utils/otaVersions';
import { getOtaChangelogEntry, getOtaChangelogTitle } from './runtime';

describe('runtime changelog helpers', () => {
    it('formats ota metadata into a dated changelog title', () => {
        const version: OtaVersion = {
            stamp: '1720000000000',
            id: '1234567890abcdef',
            createdAt: '2024-07-03T09:46:40.000Z',
            channel: 'preview',
            git: {
                sha: 'abcdef12',
                subject: 'fix(app): fallback subject',
            },
            display: {
                title: 'feat(settings): show my PR notes',
            },
        };

        expect(getOtaChangelogTitle(version)).toBe('July 3 — feat(settings): show my PR notes');
    });

    it('includes release notes metadata and source links when present', () => {
        const version: OtaVersion = {
            stamp: '1720000000000',
            id: '1234567890abcdef',
            createdAt: '2024-07-03T09:46:40.000Z',
            channel: 'preview',
            git: {
                sha: 'abcdef12',
                branch: 'feat/changelog',
                subject: 'feat(app): ota changelog',
            },
            display: {
                title: 'feat(settings): ship personal changelog',
                message: '- show OTA notes\n- link back to PR',
                source: {
                    number: '84',
                    url: 'https://github.com/wangjs-jacky/happy/pull/84',
                },
            },
        };

        const entry = getOtaChangelogEntry(version);
        expect(entry.title).toContain('feat(settings): ship personal changelog');
        expect(entry.summary).toContain('show OTA notes');
        expect(entry.markdown).toContain('PR #84');
        expect(entry.markdown).toContain('[Open PR](https://github.com/wangjs-jacky/happy/pull/84)');
    });
});
