import { describe, it, expect } from 'vitest';
import { buildScreencaptureArgs } from './screenshot';

describe('buildScreencaptureArgs', () => {
    it('desktop 整屏：-x 静音 + 输出路径', () => {
        expect(buildScreencaptureArgs('desktop', '/tmp/a.png'))
            .toEqual(['-x', '/tmp/a.png']);
    });
    it('browser 最前窗口（MVP 阶段也走整屏兜底）：-x + 输出路径', () => {
        expect(buildScreencaptureArgs('browser', '/tmp/b.png'))
            .toEqual(['-x', '/tmp/b.png']);
    });
});
