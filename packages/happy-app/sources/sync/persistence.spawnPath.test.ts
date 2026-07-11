import { describe, it, expect, beforeEach } from 'vitest';
import { loadSessionSpawnPaths, saveSessionSpawnPaths } from './persistence';

describe('session spawn paths persistence', () => {
    beforeEach(() => {
        saveSessionSpawnPaths({});
    });

    it('returns empty object when nothing saved', () => {
        expect(loadSessionSpawnPaths()).toEqual({});
    });

    it('round-trips saved paths', () => {
        saveSessionSpawnPaths({ s1: '/a/健康打卡', s2: '/b/repo' });
        expect(loadSessionSpawnPaths()).toEqual({ s1: '/a/健康打卡', s2: '/b/repo' });
    });
});
