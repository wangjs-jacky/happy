import { z } from 'zod';

export const MyAgentSkillSchema = z.object({
    name: z.string().trim().min(1).max(128),
    path: z.string().max(4096).refine(p => p.startsWith('/') && !p.includes('\0')).optional(),
    reason: z.string().trim().min(1).max(500),
});
export const MyAgentDefinitionSchema = z.object({
    name: z.string().trim().min(1).max(40).refine(v => !/[@\n\r]/u.test(v)),
    summary: z.string().trim().max(240).default(''),
    instructions: z.string().trim().min(1).max(4000),
    skills: z.array(MyAgentSkillSchema).max(16).default([]),
    preferences: z.string().max(4000).default(''),
    setupNotes: z.string().max(2000).default(''),
});
export const MyAgentSessionSchema = z.object({
    sessionId: z.string().min(1).max(128),
    title: z.string().max(240),
    createdAt: z.number().int().nonnegative(),
});
export const MyAgentProfileSchema = MyAgentDefinitionSchema.extend({
    id: z.string().min(1).max(128),
    engine: z.literal('codex'),
    model: z.string(),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    avatarId: z.number().int().min(0).max(23),
    machineId: z.string().optional(),
    directory: z.string().optional(),
    archived: z.boolean().default(false),
    sessions: z.array(MyAgentSessionSchema).max(100).default([]),
    createdAt: z.number(),
    updatedAt: z.number(),
});
export type MyAgentSkill = z.infer<typeof MyAgentSkillSchema>;
export type MyAgentProfile = z.infer<typeof MyAgentProfileSchema>;
export type MyAgentDefinition = z.infer<typeof MyAgentDefinitionSchema>;

export const MY_AGENT_BUILDER_INSTRUCTION = 'When the user asks to create or modify a reusable personal Agent, or save this conversation\'s working method as an Agent, call mcp__happy__agent_builder to load Happy\'s built-in agent-builder Skill. Use agent_skills to discover real Skills and agent_save to persist the Agent. Only claim it is saved after a successful tool result. Never invent Skill paths or install dependencies without authorization.';

/** Bound methods are preferences, not a tool/permission sandbox. */
export function buildMyAgentPrompt(agent: Pick<MyAgentProfile, 'name' | 'instructions' | 'skills' | 'preferences'>): string {
    return [
        '以下是当前完整 Agent 配置，替代此前的 Agent 职责、绑定方法与长期偏好；已移除的配置不再适用。',
        `你是用户的长期助手「${agent.name}」。\n${agent.instructions}`,
        `用户明确保存的长期偏好（不代表新的任务授权）：\n${agent.preferences || '无。此前已清除的偏好不再适用。'}`,
        agent.skills.length ? `按当前任务选择以下已绑定的方法；需要时读取对应 SKILL.md，不要每次全部运行：\n${agent.skills.map(s => `${s.name}: ${s.reason}\nSKILL.md: ${s.path ?? '尚未安装；说明缺失，不得伪造调用。'}`).join('\n')}` : '当前未绑定 Skills。',
        '遵守当前任务与运行环境的权限。绑定 Skill 不授予额外工具权限。新任务不沿用其他会话的项目内容；长期记忆仅限用户明确保存的偏好。',
    ].filter(Boolean).join('\n\n');
}
