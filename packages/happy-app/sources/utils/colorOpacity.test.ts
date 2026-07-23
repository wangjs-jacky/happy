import { describe, expect, it } from 'vitest';
import { multiplyColorOpacity } from './colorOpacity';

describe('multiplyColorOpacity', () => {
    it('为不透明颜色应用目标透明度', () => {
        expect(multiplyColorOpacity('#000000', 0.25)).toBe('rgba(0, 0, 0, 0.25)');
    });

    it('保留原始透明度并按比例叠加', () => {
        expect(multiplyColorOpacity('rgba(12, 34, 56, 0.4)', 0.25))
            .toBe('rgba(12, 34, 56, 0.1)');
    });

    it('无法解析颜色时返回原值', () => {
        expect(multiplyColorOpacity('not-a-color', 0.25)).toBe('not-a-color');
    });
});
