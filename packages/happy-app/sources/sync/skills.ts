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
            source: path.includes('/.claude/plugins/') ? 'plugin' as const : 'personal' as const,
        };
    }).filter(e => e.path);
}

/** 在宿主机扫描所有 SKILL.md 并解析为 SkillEntry[] */
export async function scanSkills(machineId: string): Promise<SkillEntry[]> {
    // 两个扫描根：
    //   1) ~/.claude/skills —— 个人 skill，多为 symlink（j-skills link 出来的），
    //      必须 find -L 跟随符号链接，否则一个都扫不到。
    //   2) ~/.claude/plugins —— 插件 skill，分布在 cache/ 与 marketplaces/ 两处，
    //      统一从 plugins 根扫，maxdepth 8 覆盖最深的 marketplaces 布局。
    // NUL 分隔遍历，避免路径含空格/通配符时被 word-splitting 拆坏。
    // 注：desc 只取 frontmatter 中 description 的首行——多行 YAML 标量会被截断，
    // 但足够提炼触发词；详情页读全文不受影响。awk 顺手剥掉值两侧的引号。
    const cmd = String.raw`
{ find -L "$HOME/.claude/skills" -maxdepth 2 -name SKILL.md -print0 2>/dev/null;
  find -L "$HOME/.claude/plugins" -maxdepth 8 -name SKILL.md -print0 2>/dev/null; } |
while IFS= read -r -d '' f; do
  name=$(awk -F': *' '/^name:/{v=$2; gsub(/^"|"$/,"",v); print v; exit}' "$f")
  desc=$(awk '/^description:/{sub(/^description: */,""); gsub(/^"|"$/,"",$0); print; exit}' "$f")
  printf '%s\x1f%s\x1f%s\x1e' "$f" "$name" "$desc"
done
`;
    // 动态导入：./ops 会传递性引入 react-native，静态导入会让纯函数单测无法加载
    const { machineBash } = await import('./ops');
    const res = await machineBash(machineId, { command: cmd, timeout: 20000 });
    if (!res.success) throw new Error(res.error || res.stderr || '扫描失败');
    return parseSkillList(res.stdout);
}
