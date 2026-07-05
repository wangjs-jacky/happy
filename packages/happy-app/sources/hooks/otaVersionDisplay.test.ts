import { describe, expect, it } from 'vitest';
import {
    compactOtaMessage,
    formatOtaVersionLine,
    getOtaVersionState,
    getRecommendedOtaVersion,
} from './otaVersionDisplay';
import { OtaVersion } from './useOtaVersions';

const version = (overrides: Partial<OtaVersion>): OtaVersion => ({
    stamp: '1783232002648',
    id: 'bdd6e2d9-af43-584c-6f55-21146c206007',
    createdAt: '2026-07-05T06:13:22.648Z',
    channel: 'preview',
    git: {
        sha: '9bbd358d',
        branch: 'skills-timeline-panel',
        subject: 'fix(happy-app): show full Codex skills in right panel',
        dirty: true,
    },
    ...overrides,
});

describe('otaVersionDisplay', () => {
    it('uses display metadata as the human-readable title', () => {
        const line = formatOtaVersionLine(version({
            display: {
                title: '能力中心快捷指令与返回逻辑',
                message: '移除最近资源，并添加快捷指令。',
                source: { type: 'pull_request', number: '95' },
            },
        }), {
            formatDate: () => '2026/7/5 14:13:22',
        });

        expect(line.title).toBe('能力中心快捷指令与返回逻辑');
        expect(line.subtitle).toContain('PR #95');
        expect(line.subtitle).toContain('fix(happy-app): show full Codex skills in right panel');
        expect(line.subtitle).toContain('9bbd358d*');
        expect(line.message).toBe('移除最近资源，并添加快捷指令。');
    });

    it('falls back to commit subject when display title is absent', () => {
        const line = formatOtaVersionLine(version({ display: undefined }), {
            formatDate: () => 'now',
        });

        expect(line.title).toBe('fix(happy-app): show full Codex skills in right panel');
        expect(line.subtitle).toBe('9bbd358d* · skills-timeline-panel · now');
    });

    it('selects the first version as the recommended latest preview OTA', () => {
        const latest = version({ stamp: '2', id: 'latest-update-id' });
        const older = version({ stamp: '1', id: 'older-update-id' });

        expect(getRecommendedOtaVersion([latest, older])).toBe(latest);
        expect(getRecommendedOtaVersion([])).toBeNull();
    });

    it('reports running and locked state independently', () => {
        const v = version({});

        expect(getOtaVersionState(v, v.id, v.stamp)).toEqual({
            isRunning: true,
            isLocked: true,
        });
        expect(getOtaVersionState(v, 'other', null)).toEqual({
            isRunning: false,
            isLocked: false,
        });
    });

    it('compacts long release notes for confirmation and recommendation copy', () => {
        expect(compactOtaMessage('a\n\n\n\nb')).toBe('a\n\nb');
        expect(compactOtaMessage('abcdef', 3)).toBe('abc...');
        expect(compactOtaMessage(undefined)).toBe('');
    });
});
