import { describe, it, expect } from 'vitest';
import { shouldGreet } from './healthSessionView';

describe('shouldGreet', () => {
    const base = { isHealth: true, visibleCount: 0, alreadyGreeted: false, online: true };
    it('greets a fresh online health session once', () => {
        expect(shouldGreet(base)).toBe(true);
    });
    it('does not greet when already greeted', () => {
        expect(shouldGreet({ ...base, alreadyGreeted: true })).toBe(false);
    });
    it('does not greet when there are visible messages', () => {
        expect(shouldGreet({ ...base, visibleCount: 1 })).toBe(false);
    });
    it('does not greet non-health sessions', () => {
        expect(shouldGreet({ ...base, isHealth: false })).toBe(false);
    });
    it('does not greet when offline', () => {
        expect(shouldGreet({ ...base, online: false })).toBe(false);
    });
});
