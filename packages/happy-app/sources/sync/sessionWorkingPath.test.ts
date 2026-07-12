import { describe, it, expect } from 'vitest';
import { sessionWorkingPath } from './sessionWorkingPath';

describe('sessionWorkingPath', () => {
    it('prefers metadata.path', () => {
        expect(sessionWorkingPath({ metadata: { path: '/a' }, spawnPath: '/b' } as any)).toBe('/a');
    });
    it('falls back to spawnPath when metadata missing', () => {
        expect(sessionWorkingPath({ metadata: null, spawnPath: '/b/健康打卡' } as any)).toBe('/b/健康打卡');
    });
    it('returns null when neither present', () => {
        expect(sessionWorkingPath({ metadata: null } as any)).toBeNull();
        expect(sessionWorkingPath(null)).toBeNull();
    });
});
