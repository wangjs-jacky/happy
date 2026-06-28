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

const UNIT = '\x1f';
const RECORD = '\x1e';

export function parseSkillList(raw: string): SkillEntry[] {
    if (!raw?.trim()) return [];
    return raw.split(RECORD).map(line => line.trim()).filter(Boolean).map(line => {
        const [path = '', name = '', description = ''] = line.split(UNIT);
        return {
            path,
            name: name || path.split('/').slice(-2, -1)[0] || path,
            description,
            triggers: parseTriggers(description),
            source: path.includes('/plugins/cache/') ? 'plugin' as const : 'personal' as const,
        };
    }).filter(e => e.path);
}

/** 在宿主机扫描所有 SKILL.md 并解析为 SkillEntry[] */
export async function scanSkills(machineId: string): Promise<SkillEntry[]> {
    const cmd = String.raw`
for f in $(find "$HOME/.claude/skills" "$HOME"/.claude/plugins/cache/*/*/*/skills -maxdepth 2 -name SKILL.md 2>/dev/null); do
  name=$(awk -F': *' '/^name:/{print $2; exit}' "$f")
  desc=$(awk '/^description:/{sub(/^description: */,""); print; exit}' "$f")
  printf '%s\x1f%s\x1f%s\x1e' "$f" "$name" "$desc"
done
`;
    // 动态导入：./ops 会传递性引入 react-native，静态导入会让纯函数单测无法加载
    const { machineBash } = await import('./ops');
    const res = await machineBash(machineId, { command: cmd, timeout: 20000 });
    if (!res.success) throw new Error(res.error || res.stderr || '扫描失败');
    return parseSkillList(res.stdout);
}
