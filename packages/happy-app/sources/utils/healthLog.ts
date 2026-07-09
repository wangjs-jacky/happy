/**
 * 健康打卡日报解析。
 *
 * 右面板（HealthCheckinPanel）需要从 `<agent 目录>/日报/YYYY-MM-DD.md` 的 YAML
 * frontmatter 里抽取「今日打卡了哪几类」和「睡眠评分趋势」。日报格式由本项目的
 * `健康打卡/CLAUDE.md` 固定，所以这里不引入 YAML 库，用定向正则抽取即可，够健壮也够轻。
 */

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

/** 取首个 `---\n ... \n---` frontmatter；没有就退回整串（容错）。 */
function extractFrontmatter(content: string): string {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return m ? m[1] : content;
}

/** 解析一篇日报的 frontmatter，抽取右面板要用的字段。 */
export function parseHealthLog(filename: string, content: string): HealthLog {
    const fm = extractFrontmatter(content);
    const scoreMatch = fm.match(/评分:\s*(\d+)/);
    return {
        date: dateFromReportFilename(filename) ?? '',
        // 顶层 key 顶格出现（YAML 一级键在第 0 列）
        hasExercise: /^运动:/m.test(fm),
        hasSleep: /^睡眠:/m.test(fm),
        hasDiet: /^饮食:/m.test(fm),
        sleepScore: scoreMatch ? parseInt(scoreMatch[1], 10) : null,
    };
}

/** 本地时区今天的 YYYY-MM-DD（用于定位当天日报，不能用 UTC 否则跨日错位）。 */
export function todayLocalISO(now: Date): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
