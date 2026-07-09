// packages/happy-app/sources/utils/healthLog.test.ts
import { describe, it, expect } from 'vitest';
import { parseDuration, parseHealthLog, buildSleepView, buildExerciseView, buildDietView, pickSleepView } from './healthLog';

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
    it('剥离 YAML 行内注释后再解析（防漂移静默丢字段）', () => {
        const fm = `---\n睡眠:\n  总时长: 4h1m  # 偏少\n  深睡: 0h55m # 占比低\n---`;
        const l = parseHealthLog('x.md', fm);
        expect(l.sleepTotalMin).toBe(241);
        expect(l.deepMin).toBe(55);
    });
});

describe('buildSleepView', () => {
    const log = parseHealthLog('2026-07-06.md', FM_0706);
    const v = buildSleepView(log)!;
    it('占比按各阶段之和为分母', () => {
        // 55 + 118 + 68 = 241；深睡 55/241 ≈ 0.228
        expect(v.stages.map(s => s.key)).toEqual(['deep', 'light', 'rem']);
        expect(v.stages[0].ratio).toBeCloseTo(55 / 241, 3);
        expect(v.stages[2].ratio).toBeCloseTo(68 / 241, 3);
    });
    it('总时长格式化为 XhYm', () => {
        expect(v.totalLabel).toBe('4h1m');
    });
    it('无睡眠数据返回 null', () => {
        const empty = parseHealthLog('x.md', '---\ndate: 2026-06-17\n---');
        expect(buildSleepView(empty)).toBeNull();
    });
});

// ──────────────────────────────────────────────────────────
// 运动 / 饮食解析测试
// ──────────────────────────────────────────────────────────

const FM_EX = `---\n运动:\n  - 类型: 力量/健身房\n    场景: 健身房\n    消耗卡路里: null\n    备注: 打卡\n---`;
// → exerciseTypes ['力量/健身房'], exerciseBurn null, buildExerciseView non-null (types present)

const FM_DIET = `---\n饮食:\n  - 餐: 夜宵\n    内容: 炒面\n    卡路里: 760\n汇总:\n  摄入卡路里: 760\n---`;
// → meals [{name:'夜宵', kcal:760}], intakeKcal 760

const FM_MULTI = `---\n运动:\n  - 类型: 跑步\n    消耗卡路里: 320\n  - 类型: 拉伸\n饮食:\n  - 餐: 早餐\n    卡路里: 350\n  - 餐: 午餐\n    卡路里: 600\n---`;
// → exerciseTypes ['跑步','拉伸'], exerciseBurn 320; meals 2 items (350,600), intakeKcal (no 汇总) = 950 (sum)

const FM_EMPTY = `---\ndate: 2026-06-17\n---`;
// → exerciseTypes [], exerciseBurn null, meals [], intakeKcal null; buildExerciseView null, buildDietView null

describe('parseHealthLog 运动字段', () => {
    it('单项运动：类型提取、消耗卡路里为 null', () => {
        const log = parseHealthLog('2026-07-01.md', FM_EX);
        expect(log.exerciseTypes).toEqual(['力量/健身房']);
        expect(log.exerciseBurn).toBeNull();
    });

    it('多项运动：多类型、求和消耗卡路里', () => {
        const log = parseHealthLog('2026-07-01.md', FM_MULTI);
        expect(log.exerciseTypes).toEqual(['跑步', '拉伸']);
        expect(log.exerciseBurn).toBe(320);
    });

    it('无运动字段：exerciseTypes 为空数组，exerciseBurn 为 null', () => {
        const log = parseHealthLog('2026-06-17.md', FM_EMPTY);
        expect(log.exerciseTypes).toEqual([]);
        expect(log.exerciseBurn).toBeNull();
    });

    it('运动段 exerciseBurn 不误算饮食 kcal（FM_MULTI：320，不含 350+600）', () => {
        const log = parseHealthLog('2026-07-01.md', FM_MULTI);
        expect(log.exerciseBurn).toBe(320);
    });
});

describe('parseHealthLog 饮食字段', () => {
    it('单项饮食：meals 正确，intakeKcal 取汇总', () => {
        const log = parseHealthLog('2026-07-01.md', FM_DIET);
        expect(log.meals).toEqual([{ name: '夜宵', kcal: 760 }]);
        expect(log.intakeKcal).toBe(760);
    });

    it('多项饮食：无汇总时 intakeKcal 退化为 meals kcal 之和', () => {
        const log = parseHealthLog('2026-07-01.md', FM_MULTI);
        expect(log.meals).toEqual([
            { name: '早餐', kcal: 350 },
            { name: '午餐', kcal: 600 },
        ]);
        expect(log.intakeKcal).toBe(950);
    });

    it('无饮食字段：meals 为空数组，intakeKcal 为 null', () => {
        const log = parseHealthLog('2026-06-17.md', FM_EMPTY);
        expect(log.meals).toEqual([]);
        expect(log.intakeKcal).toBeNull();
    });
});

describe('buildExerciseView', () => {
    it('有类型时返回非 null 视图', () => {
        const log = parseHealthLog('2026-07-01.md', FM_EX);
        const view = buildExerciseView(log);
        expect(view).not.toBeNull();
        expect(view!.types).toEqual(['力量/健身房']);
        expect(view!.burn).toBeNull();
    });

    it('无运动数据返回 null', () => {
        const log = parseHealthLog('2026-06-17.md', FM_EMPTY);
        expect(buildExerciseView(log)).toBeNull();
    });

    it('有消耗卡路里时 burn 有值', () => {
        const log = parseHealthLog('2026-07-01.md', FM_MULTI);
        const view = buildExerciseView(log);
        expect(view).not.toBeNull();
        expect(view!.burn).toBe(320);
    });
});

describe('buildDietView', () => {
    it('有饮食数据时返回非 null 视图', () => {
        const log = parseHealthLog('2026-07-01.md', FM_DIET);
        const view = buildDietView(log);
        expect(view).not.toBeNull();
        expect(view!.meals).toEqual([{ name: '夜宵', kcal: 760 }]);
        expect(view!.intakeKcal).toBe(760);
    });

    it('无饮食数据返回 null', () => {
        const log = parseHealthLog('2026-06-17.md', FM_EMPTY);
        expect(buildDietView(log)).toBeNull();
    });
});

describe('pickSleepView 兜底（今天没记录→最近一晚）', () => {
    const todaySleep = parseHealthLog('2026-07-10.md', `---\n睡眠:\n  总时长: 6h0m\n  评分: 80\n---`);
    const pastSleep = parseHealthLog('2026-07-09.md', `---\n睡眠:\n  总时长: 5h30m\n  评分: 74\n---`);
    const noSleep = parseHealthLog('2026-07-10.md', `---\n饮食:\n  - 餐: 早餐\n    卡路里: 300\n---`);
    it('今天有睡眠 → 用今天', () => {
        expect(pickSleepView(todaySleep, [pastSleep, todaySleep])?.date).toBe('2026-07-10');
    });
    it('今天有报告但无睡眠 → 回退最近一晚', () => {
        expect(pickSleepView(noSleep, [pastSleep, noSleep])?.date).toBe('2026-07-09');
    });
    it('今天为 null → 回退 trend 最近有睡眠的', () => {
        expect(pickSleepView(null, [pastSleep])?.date).toBe('2026-07-09');
    });
    it('全无睡眠 → null', () => {
        expect(pickSleepView(null, [noSleep])).toBeNull();
    });
});
