import { describe, it, expect } from 'vitest';
import { parseTriggers } from './skills';

describe('parseTriggers', () => {
    it('抽取中文「触发词：」列表', () => {
        expect(parseTriggers('上下文快照工具。触发词：add、resolve、批次处理')).toEqual(['add', 'resolve', '批次处理']);
    });
    it('抽取「触发于」格式', () => {
        expect(parseTriggers('评分评估 Agent。触发于 /tw-scorer 或编排器触发。')).toEqual(['/tw-scorer']);
    });
    it('抽取英文 Triggers include', () => {
        const r = parseTriggers('Browser automation. Triggers include "open a website", "fill out a form".');
        expect(r).toContain('open a website');
        expect(r).toContain('fill out a form');
    });
    it('无触发词时兜底取第一句', () => {
        expect(parseTriggers('Deploy applications to Vercel. Use later.')).toEqual(['Deploy applications to Vercel']);
    });
    it('空 description 返回空数组', () => {
        expect(parseTriggers('')).toEqual([]);
    });
});
