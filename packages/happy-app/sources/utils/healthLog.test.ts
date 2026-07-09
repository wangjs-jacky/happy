// packages/happy-app/sources/utils/healthLog.test.ts
import { describe, it, expect } from 'vitest';
import { parseDuration } from './healthLog';

describe('parseDuration', () => {
    it('主格式 XhYm', () => {
        expect(parseDuration('7h20m')).toBe(440);
        expect(parseDuration('0h55m')).toBe(55);
        expect(parseDuration('8h0m')).toBe(480);
        expect(parseDuration('1h8m')).toBe(68);
    });
    it('容错退化写法', () => {
        expect(parseDuration('55min')).toBe(55);
        expect(parseDuration('55m')).toBe(55);
        expect(parseDuration('8h')).toBe(480);
    });
    it('非法/空 → null', () => {
        expect(parseDuration('abc')).toBeNull();
        expect(parseDuration('')).toBeNull();
        expect(parseDuration(null)).toBeNull();
        expect(parseDuration(undefined)).toBeNull();
    });
});
