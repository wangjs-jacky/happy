/**
 * 健康打卡日报解析。
 *
 * 右面板（HealthCheckinPanel）需要从 `<agent 目录>/日报/YYYY-MM-DD.md` 的 YAML
 * frontmatter 里抽取「今日打卡了哪几类」和「睡眠评分趋势」。日报格式由本项目的
 * `健康打卡/CLAUDE.md` 固定，所以这里不引入 YAML 库，用定向正则抽取即可，够健壮也够轻。
 */

/**
 * 带单位时长字符串 → 分钟。主格式 `XhYm`（7h20m/0h55m/1h8m/8h），
 * 并容错退化写法 55min/55m（防 agent 自检漏网时静默丢字段）。非法/空返回 null。
 * 这是「带单位字符串 → 数值」的唯一入口，面板结构/趋势都经它。
 */
export function parseDuration(raw: string | null | undefined): number | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    const hm = s.match(/^(\d+)h(?:(\d+)m?)?$/);       // 7h20m / 7h20 / 8h
    if (hm) return parseInt(hm[1], 10) * 60 + (hm[2] ? parseInt(hm[2], 10) : 0);
    const mm = s.match(/^(\d+)m(?:in)?$/);            // 55m / 55min
    if (mm) return parseInt(mm[1], 10);
    return null;
}

export interface HealthLog {
    /** YYYY-MM-DD，取自文件名 */
    date: string;
    /** frontmatter 是否含顶层「运动:」 */
    hasExercise: boolean;
    /** 是否含顶层「睡眠:」 */
    hasSleep: boolean;
    /** 是否含顶层「饮食:」 */
    hasDiet: boolean;
    /** 睡眠评分（睡眠.评分）；无则 null */
    sleepScore: number | null;
    // —— 睡眠时长/结构（分钟；无则 null）——
    /** 总时长（夜间主睡，不含小睡） */
    sleepTotalMin: number | null;
    /** 深睡 */
    deepMin: number | null;
    /** 浅睡 */
    lightMin: number | null;
    /** 快速眼动 REM */
    remMin: number | null;
    /** 日间小睡 */
    napMin: number | null;
    // —— 睡眠文本字段 ——
    /** 质量：差/一般/良好/优秀 */
    sleepQuality: string | null;
    /** 入睡 HH:MM */
    bedtime: string | null;
    /** 起床 HH:MM */
    wakeTime: string | null;
    // —— 运动字段 ——
    /** 运动块内所有「类型:」值（无则 []） */
    exerciseTypes: string[];
    /** 运动块「消耗卡路里:」数字之和；无数字则 null */
    exerciseBurn: number | null;
    // —— 饮食字段 ——
    /** 饮食块逐项（餐名 + 卡路里） */
    meals: { name: string; kcal: number | null }[];
    /** 汇总.摄入卡路里；无则退化为 meals kcal 之和；再无则 null */
    intakeKcal: number | null;
}

/** base64 → utf8（日报是中文，必须走字节解码，不能直接 atob 当 latin1） */
export function decodeBase64Utf8(base64: string): string {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

/** 日报文件名（2026-06-25.md）→ 日期；不匹配返回 null。 */
export function dateFromReportFilename(name: string): string | null {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    return m ? m[1] : null;
}

/** 日报文件名判定（右面板只认 YYYY-MM-DD.md）。 */
export function isReportFilename(name: string): boolean {
    return /^\d{4}-\d{2}-\d{2}\.md$/.test(name);
}

/**
 * 从 frontmatter 抽某个睡眠子键的原始值（键在缩进层，故用多行匹配、取到行尾）。
 * 先剥离 YAML 行内注释（` # …`）再去引号——否则 `总时长: 4h1m # 偏少` 会带着注释
 * 喂进 parseDuration 直接返 null、静默丢字段（正是要防的 agent 落笔漂移）。
 * 注：不限定在 `睡眠:` 段内（沿用本文件「定向正则、不引 YAML 库」的取舍）；
 * 当前 schema 这些键名只出现在睡眠段，故安全。
 */
function extractField(fm: string, key: string): string | null {
    const m = fm.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(.+?)\\s*(?:\\n|$)`));
    if (!m) return null;
    return m[1].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');   // 去行内注释、去引号
}

/** 取首个 `---\n ... \n---` frontmatter；没有就退回整串（容错）。 */
function extractFrontmatter(content: string): string {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return m ? m[1] : content;
}

/**
 * 从 frontmatter 抽取某个顶层 YAML 键（第 0 列）下的缩进块文本。
 * 匹配从 `^key:\n` 开始，到下一个第 0 列键或文本末尾结束。
 * 返回缩进块的原始文本（含前导空白），供调用方做二次正则扫描。
 */
function extractSection(fm: string, key: string): string {
    const m = fm.match(new RegExp(`(?:^|\\n)${key}:[ \\t]*\\n((?:[ \\t]+.*(?:\\n|$))*)`));
    return m ? m[1] : '';
}

/**
 * 解析运动块中所有「类型:」值，返回 trimmed 字符串数组。
 * 「消耗卡路里: null」不含数字，\d+ 正则天然跳过，无需特殊处理。
 */
function parseExerciseTypes(section: string): string[] {
    const result: string[] = [];
    const re = /类型:\s*(.+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(section)) !== null) {
        result.push(m[1].trim());
    }
    return result;
}

/**
 * 解析运动块中所有「消耗卡路里:」的数字之和。
 * 「消耗卡路里: null」不匹配 \d+，自动跳过。无任何数字则返回 null。
 */
function parseExerciseBurn(section: string): number | null {
    const re = /消耗卡路里:\s*(\d+)/g;
    let m: RegExpExecArray | null;
    let total = 0;
    let found = false;
    while ((m = re.exec(section)) !== null) {
        total += parseInt(m[1], 10);
        found = true;
    }
    return found ? total : null;
}

/**
 * 解析饮食块中每个列表项（以「- 」起始）的餐名和卡路里。
 * 策略：以「餐:」为锚，每次找到「餐:」后，向后截取到下一个「餐:」或块尾，
 * 在该段内找最近的「卡路里:」数字（可选）。这样每项餐食各自独立，不越界。
 */
function parseMeals(section: string): { name: string; kcal: number | null }[] {
    const result: { name: string; kcal: number | null }[] = [];
    const mealRe = /餐:\s*(.+)/g;
    // 找到所有餐: 的位置和名称
    const anchors: { index: number; name: string }[] = [];
    let ma: RegExpExecArray | null;
    while ((ma = mealRe.exec(section)) !== null) {
        anchors.push({ index: ma.index + ma[0].length, name: ma[1].trim() });
    }
    for (let i = 0; i < anchors.length; i += 1) {
        const start = anchors[i].index;
        const end = i + 1 < anchors.length ? anchors[i + 1].index - anchors[i + 1].name.length - 4 : section.length;
        const slice = section.slice(start, end);
        const kcalM = slice.match(/卡路里:\s*(\d+)/);
        result.push({
            name: anchors[i].name,
            kcal: kcalM ? parseInt(kcalM[1], 10) : null,
        });
    }
    return result;
}

/**
 * 计算 intakeKcal：
 * 1. 优先取 frontmatter 中唯一的「摄入卡路里:」数值（位于汇总块）。
 * 2. 否则对 meals 中所有非 null kcal 求和；无任何非 null 项则返回 null。
 */
function parseIntakeKcal(fm: string, meals: { name: string; kcal: number | null }[]): number | null {
    const explicit = fm.match(/摄入卡路里:\s*(\d+)/);
    if (explicit) return parseInt(explicit[1], 10);
    const nonNull = meals.map(m => m.kcal).filter((k): k is number => k !== null);
    if (nonNull.length === 0) return null;
    return nonNull.reduce((a, b) => a + b, 0);
}

/**
 * 从 frontmatter 抽取睡眠评分。兼容两种写法（agent 实际落笔会漂移）：
 *   1) 规范：`评分: 82`
 *   2) 漂移：评分揉进质量文本，如 `质量: 74分（四星，超过33%用户）`
 * 优先取规范的 `评分:`；否则从 `质量:` 那一行里抽「N 分」。
 * 只在 质量 行内抽，避免误伤时长里的「30分钟」。
 */
function extractSleepScore(fm: string): number | null {
    const explicit = fm.match(/评分:\s*(\d+)/);
    if (explicit) return parseInt(explicit[1], 10);
    const quality = fm.match(/质量:[^\n]*?(\d+)\s*分/);
    if (quality) return parseInt(quality[1], 10);
    return null;
}

/** 解析一篇日报的 frontmatter，抽取右面板要用的字段。 */
export function parseHealthLog(filename: string, content: string): HealthLog {
    const fm = extractFrontmatter(content);
    const exerciseSection = extractSection(fm, '运动');
    const dietSection = extractSection(fm, '饮食');
    const meals = parseMeals(dietSection);
    return {
        date: dateFromReportFilename(filename) ?? '',
        // 顶层 key 顶格出现（YAML 一级键在第 0 列）
        hasExercise: /^运动:/m.test(fm),
        hasSleep: /^睡眠:/m.test(fm),
        hasDiet: /^饮食:/m.test(fm),
        sleepScore: extractSleepScore(fm),
        sleepTotalMin: parseDuration(extractField(fm, '总时长')),
        deepMin: parseDuration(extractField(fm, '深睡')),
        lightMin: parseDuration(extractField(fm, '浅睡')),
        remMin: parseDuration(extractField(fm, '快速眼动')),
        napMin: parseDuration(extractField(fm, '日间小睡')),
        sleepQuality: extractField(fm, '质量'),
        bedtime: extractField(fm, '入睡'),
        wakeTime: extractField(fm, '起床'),
        exerciseTypes: parseExerciseTypes(exerciseSection),
        exerciseBurn: parseExerciseBurn(exerciseSection),
        meals,
        intakeKcal: parseIntakeKcal(fm, meals),
    };
}

export interface SleepStage { key: 'deep' | 'light' | 'rem'; min: number; ratio: number }
export interface SleepView {
    totalMin: number | null;
    totalLabel: string | null;     // XhYm 可读串
    score: number | null;
    quality: string | null;
    bedtime: string | null;
    wakeTime: string | null;
    stages: SleepStage[];          // 占比之和为分母；无结构数据则空数组
}

/** 分钟 → 'XhYm'（如 241 → '4h1m'）。null 返回 null。 */
export function formatMinutes(min: number | null): string | null {
    if (min == null) return null;
    return `${Math.floor(min / 60)}h${min % 60}m`;
}

/** HealthLog → 面板睡眠视图。无任何睡眠信号（无总时长/评分/结构）时返回 null。 */
export function buildSleepView(log: HealthLog): SleepView | null {
    const rawStages = [
        { key: 'deep' as const, min: log.deepMin },
        { key: 'light' as const, min: log.lightMin },
        { key: 'rem' as const, min: log.remMin },
    ].filter((s): s is { key: 'deep' | 'light' | 'rem'; min: number } => s.min != null && s.min > 0);
    const sum = rawStages.reduce((a, s) => a + s.min, 0);
    const stages: SleepStage[] = sum > 0 ? rawStages.map(s => ({ ...s, ratio: s.min / sum })) : [];

    const hasAny = log.sleepTotalMin != null || log.sleepScore != null || stages.length > 0;
    if (!hasAny) return null;
    return {
        totalMin: log.sleepTotalMin,
        totalLabel: formatMinutes(log.sleepTotalMin),
        score: log.sleepScore,
        quality: log.sleepQuality,
        bedtime: log.bedtime,
        wakeTime: log.wakeTime,
        stages,
    };
}

/** 本地时区今天的 YYYY-MM-DD（用于定位当天日报，不能用 UTC 否则跨日错位）。 */
export function todayLocalISO(now: Date): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** 运动视图模型（面板展示用）。 */
export interface ExerciseView {
    /** 运动类型列表 */
    types: string[];
    /** 消耗卡路里总量；无数字则 null */
    burn: number | null;
}

/** 饮食视图模型（面板展示用）。 */
export interface DietView {
    /** 饮食列表（餐名 + 卡路里） */
    meals: { name: string; kcal: number | null }[];
    /** 摄入总卡路里；无数据则 null */
    intakeKcal: number | null;
}

/**
 * HealthLog → 运动视图。
 * 无任何运动信号（types 为空 且 burn 为 null）时返回 null。
 */
export function buildExerciseView(log: HealthLog): ExerciseView | null {
    if (log.exerciseTypes.length === 0 && log.exerciseBurn === null) return null;
    return { types: log.exerciseTypes, burn: log.exerciseBurn };
}

/**
 * HealthLog → 饮食视图。
 * 无任何饮食信号（meals 为空 且 intakeKcal 为 null）时返回 null。
 */
export function buildDietView(log: HealthLog): DietView | null {
    if (log.meals.length === 0 && log.intakeKcal === null) return null;
    return { meals: log.meals, intakeKcal: log.intakeKcal };
}
