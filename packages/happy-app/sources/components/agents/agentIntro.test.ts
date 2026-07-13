import { describe, it, expect } from 'vitest';
import { resolveAgentIntroKind } from './agentIntro';

describe('resolveAgentIntroKind', () => {
    it('健康打卡路径 → health', () => {
        expect(resolveAgentIntroKind({ path: '/Users/jacky/jacky-obsidian/人生辅助系统/健康打卡' })).toBe('health');
    });
    it('普通路径 → generic', () => {
        expect(resolveAgentIntroKind({ path: '/Users/jacky/jacky-github/foo' })).toBe('generic');
    });
    it('空路径 → generic', () => {
        expect(resolveAgentIntroKind({ path: '' })).toBe('generic');
    });
});
