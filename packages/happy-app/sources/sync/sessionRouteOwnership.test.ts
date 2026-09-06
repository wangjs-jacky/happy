import { describe, expect, it } from 'vitest';
import { SessionRouteOwnership } from './sessionRouteOwnership';

describe('session route ownership', () => {
    it('ignores stale cleanup across route switches and same-session remounts', () => {
        const owners = new SessionRouteOwnership();
        const a = owners.enter('a');
        const b = owners.enter('b');
        expect(owners.leave(a)).toBe(false);
        expect(owners.current()).toBe(b);
        const newB = owners.enter('b');
        expect(owners.leave(b)).toBe(false);
        expect(owners.current()).toBe(newB);
        expect(owners.owns(a)).toBe(false);
        expect(owners.ownsSession('b')).toBe(true);
        expect(owners.leave(newB)).toBe(true);
        expect(owners.current()).toBeNull();
    });

    it('promotes only the current epoch while preserving its cleanup capability', () => {
        const owners = new SessionRouteOwnership();
        const old = owners.enter('a');
        const current = owners.enter('a');
        expect(owners.promote(old)).toBeNull();
        expect(owners.promote(current)).toEqual({ ...current, phase: 'interactive' });
        expect(current.phase).toBe('opening');
        expect(owners.owns(current)).toBe(true);
        expect(owners.leave(current)).toBe(true);
        expect(owners.promote(current)).toBeNull();
    });
});
