export interface SkillEntry {
    path: string;       // SKILL.md 绝对路径
    name: string;       // frontmatter name
    description: string;
    triggers: string[];
    source: 'personal' | 'plugin';
}

/** 从 description 提炼可能的触发词，纯本地正则，零模型 */
export function parseTriggers(description: string): string[] {
    if (!description?.trim()) return [];
    const zh = description.match(/触发词[:：]\s*([^。\n]+)/);
    if (zh) return splitList(zh[1]);
    const zhOn = description.match(/触发于\s*([^。\n，,]+)/);
    if (zhOn) return splitList(zhOn[1].replace(/\s*或.*$/, ''));
    const en = [...description.matchAll(/"([^"]+)"/g)].map(m => m[1]);
    if (/Triggers include/i.test(description) && en.length) return en;
    const first = description.split(/[。.!?\n]/)[0].trim();
    return first ? [first] : [];
}

function splitList(s: string): string[] {
    return s.split(/[、,，·]/).map(x => x.trim()).filter(Boolean);
}
