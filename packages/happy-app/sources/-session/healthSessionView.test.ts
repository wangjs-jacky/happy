import { describe, it, expect } from 'vitest';
import { shouldShowHealthWelcome } from './healthSessionView';

describe('shouldShowHealthWelcome', () => {
    it('true for empty health session', () => {
        expect(shouldShowHealthWelcome({ isHealth: true, visibleCount: 0 })).toBe(true);
    });
    it('false when there are visible messages', () => {
        expect(shouldShowHealthWelcome({ isHealth: true, visibleCount: 2 })).toBe(false);
    });
    it('false for non-health session', () => {
        expect(shouldShowHealthWelcome({ isHealth: false, visibleCount: 0 })).toBe(false);
    });
});
