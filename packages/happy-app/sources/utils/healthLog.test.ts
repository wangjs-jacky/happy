// packages/happy-app/sources/utils/healthLog.test.ts
import { describe, it, expect } from 'vitest';
import { parseDuration, parseHealthLog } from './healthLog';

const FM_0706 = `---
date: 2026-07-06
睡眠:
  总时长: 4h1m
  深睡: 0h55m
  浅睡: 1h58m
  快速眼动: 1h8m
  评分: 61
  质量: 一般
  入睡: "05:09"
  起床: "09:10"
  来源: 华为运动健康
---
正文`;

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

describe('parseHealthLog 睡眠字段', () => {
    const log = parseHealthLog('2026-07-06.md', FM_0706);
    it('时长字段解析为分钟且非 null', () => {
        expect(log.sleepTotalMin).toBe(241);
        expect(log.deepMin).toBe(55);
        expect(log.lightMin).toBe(118);
        expect(log.remMin).toBe(68);
    });
    it('评分/质量/时间点', () => {
        expect(log.sleepScore).toBe(61);
        expect(log.sleepQuality).toBe('一般');
        expect(log.bedtime).toBe('05:09');   // 去引号
        expect(log.wakeTime).toBe('09:10');
    });
    it('hasSleep 为真', () => {
        expect(log.hasSleep).toBe(true);
    });
    it('日间小睡不与深睡混淆（napMin 独立抽取）', () => {
        const fm = `---\n睡眠:\n  总时长: 7h59m\n  深睡: 2h6m\n  日间小睡: 1h36m\n  评分: 89\n---`;
        const l = parseHealthLog('2026-06-25.md', fm);
        expect(l.napMin).toBe(96);      // 1h36m
        expect(l.deepMin).toBe(126);    // 2h6m，未被 日间小睡 串味
        expect(l.sleepTotalMin).toBe(479);
    });
});
