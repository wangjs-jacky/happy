import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    parseTriggers,
    parseSkillList,
    readSkillFileBase64,
    SKILL_DESCRIPTION_AWK,
} from './skills';

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

describe('parseSkillList', () => {
    it('切分 bash 输出并标注来源', () => {
        const raw = [
            '/Users/x/.claude/skills/todo/SKILL.md\x1ftodo\x1f上下文快照。触发词：add、resolve',
            '/Users/x/.claude/plugins/cache/m/p/1/skills/foo/SKILL.md\x1ffoo\x1fBar baz.',
        ].join('\x1e');
        const list = parseSkillList(raw);
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({ name: 'todo', source: 'personal', triggers: ['add', 'resolve'] });
        expect(list[1].source).toBe('plugin');
    });
    it('marketplaces 路径也识别为 plugin', () => {
        const raw = '/Users/x/.claude/plugins/marketplaces/official/plugins/fd/skills/fd/SKILL.md\x1ffd\x1fDesc.';
        expect(parseSkillList(raw)[0].source).toBe('plugin');
    });
    it('Codex plugin 路径也识别为 plugin', () => {
        const raw = '/Users/x/.codex/plugins/cache/openai/supabase/skills/supabase/SKILL.md\x1fsupabase\x1fDesc.';
        expect(parseSkillList(raw)[0].source).toBe('plugin');
    });
    it('name 为空时回退到父目录名', () => {
        const raw = '/Users/x/.claude/skills/foo/SKILL.md\x1f\x1fBar.';
        expect(parseSkillList(raw)[0].name).toBe('foo');
    });
    it('按路径去重，避免同一个 Skill 产生重复 React key', () => {
        const line = '/Users/x/.agents/skills/foo/SKILL.md\x1ffoo\x1fBar.';
        expect(parseSkillList(`${line}\x1e${line}`)).toHaveLength(1);
    });
    it('不会把 YAML 多行描述标记符当成可见描述', () => {
        const raw = '/Users/x/.agents/skills/foo/SKILL.md\x1ffoo\x1f>';
        expect(parseSkillList(raw)[0]).toMatchObject({
            description: '',
            triggers: [],
        });
    });
    it('扫描脚本会折叠 YAML 多行描述，而不是返回块标记符', () => {
        const directory = mkdtempSync(join(tmpdir(), 'happy-skill-description-'));
        const file = join(directory, 'SKILL.md');
        writeFileSync(file, [
            '---',
            'name: demo',
            'description: >',
            '  第一行说明，',
            '  第二行说明。',
            'metadata:',
            '  owner: demo',
            '---',
        ].join('\n'));

        try {
            expect(execFileSync('awk', [SKILL_DESCRIPTION_AWK, file], { encoding: 'utf8' }).trim())
                .toBe('第一行说明， 第二行说明。');
        } finally {
            rmSync(directory, { recursive: true });
        }
    });
    it('空输出返回空数组', () => {
        expect(parseSkillList('')).toEqual([]);
    });
});

describe('readSkillFileBase64', () => {
    it('含双引号的路径直接拒绝（防命令注入），不触碰 ./ops', async () => {
        await expect(readSkillFileBase64('m', '/a/b"c/SKILL.md')).rejects.toThrow('非法的文件路径');
    });
});
