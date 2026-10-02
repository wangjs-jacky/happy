import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MyAgentDefinitionSchema, MyAgentProfileSchema } from '@slopus/happy-wire';
import { listCodexSkillEntries } from '@/codex/codexSkills';
import { loadBuiltInAgentBuilderSkill } from './myAgentCommand';
import type { ApiSessionClient } from '@/api/apiSession';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const MY_AGENT_TOOL_SCHEMAS = {
    agent_builder: {},
    agent_skills: {},
    agent_list: {},
    agent_get: { id },
    agent_save: { name: MyAgentDefinitionSchema.shape.name, instructions: MyAgentDefinitionSchema.shape.instructions,
        summary: MyAgentDefinitionSchema.shape.summary.removeDefault().optional(), skills: MyAgentDefinitionSchema.shape.skills.removeDefault().optional(),
        preferences: MyAgentDefinitionSchema.shape.preferences.removeDefault().optional(), setupNotes: MyAgentDefinitionSchema.shape.setupNotes.removeDefault().optional(),
        id: id.optional(), requestId: z.string().min(1).max(128), expectedUpdatedAt: z.number().optional(), model: z.string().optional(), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(), avatarId: z.number().int().min(0).max(23).optional() },
    agent_archive: { id, expectedUpdatedAt: z.number(), archived: z.boolean() },
} as const;
export type MyAgentToolName = keyof typeof MY_AGENT_TOOL_SCHEMAS;
export const MY_AGENT_TOOL_NAMES = Object.keys(MY_AGENT_TOOL_SCHEMAS) as MyAgentToolName[];
const descriptions: Record<MyAgentToolName, string> = {
    agent_builder: 'Load Happy\'s built-in agent-builder Skill to create or modify reusable personal Agents through conversation.',
    agent_skills: 'List real installed Skills with names, descriptions and absolute paths on this session\'s execution machine. Dependencies still require inspection.',
    agent_list: 'List this Happy account\'s saved personal Agents, including archived profiles.',
    agent_get: 'Read a saved Agent and its revision before editing. Use exact returned id and updatedAt.',
    agent_save: 'Create or update a personal Agent with role instructions and Skills. Persists to My Agents. No dependency installation or permission expansion. On updates use expectedUpdatedAt and preserve unchanged fields.',
    agent_archive: 'Archive or restore a saved Agent without deleting its history. Use only when requested.',
};

export function registerMyAgentTools(server: McpServer, invoke: (name: MyAgentToolName, args: Record<string, unknown>) => Promise<CallToolResult>): void {
    for (const name of MY_AGENT_TOOL_NAMES) server.registerTool(name, { description: descriptions[name], inputSchema: MY_AGENT_TOOL_SCHEMAS[name] }, (args: Record<string, unknown>) => invoke(name, args));
}

export function createMyAgentToolHandler(client: Pick<ApiSessionClient, 'getMetadata' | 'requestMyAgents'>) {
    return async (name: MyAgentToolName, args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
            const metadata = client.getMetadata();
            if (name === 'agent_builder') return { content: [{ type: 'text', text: loadBuiltInAgentBuilderSkill() }] };
            if (name === 'agent_skills') return { content: [{ type: 'text', text: JSON.stringify({ machineId: metadata?.machineId, directory: metadata?.path, skills: listCodexSkillEntries({ cwd: metadata?.path }) }) }] };
            const suffix = typeof args.id === 'string' ? `/${args.id}` : '';
            if (name === 'agent_list' || name === 'agent_get') {
                const result = await client.requestMyAgents(suffix);
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
            }
            let input = { ...args };
            if (name === 'agent_save') {
                const prior = suffix ? MyAgentProfileSchema.parse(await client.requestMyAgents(suffix)) : null;
                const machineId = prior?.machineId ?? metadata?.machineId;
                const directory = prior?.directory ?? metadata?.path;
                const sameMachine = !!machineId && machineId === metadata?.machineId;
                const fields = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
                const definition = MyAgentDefinitionSchema.parse({ ...prior, ...fields });
                const skills = definition.skills;
                if (sameMachine) {
                    const installed = listCodexSkillEntries({ cwd: directory });
                    for (const skill of skills) if (skill.path && !installed.some(s => s.path === skill.path && s.name === skill.name)) throw new Error(`Skill 不在当前设备目录中：${skill.name}。请重新调用 agent_skills。`);
                } else if (skills.some(s => s.path && !prior?.skills.some(p => p.name === s.name && p.path === s.path))) {
                    throw new Error('请在该 Agent 的执行设备上添加或更换 Skills；当前设备只能保留已有绑定。');
                }
                const sessionModel = metadata?.currentModelCode && /^gpt-[a-zA-Z0-9._-]{1,120}$/.test(metadata.currentModelCode) ? metadata.currentModelCode : undefined;
                input = { ...args, ...definition, engine: 'codex', model: args.model ?? prior?.model ?? sessionModel,
                    effort: args.effort ?? prior?.effort ?? metadata?.currentThoughtLevelCode, avatarId: args.avatarId ?? prior?.avatarId ?? 0,
                    ...(machineId && directory ? { machineId, directory } : {}) };
            }
            const result = await client.requestMyAgents(suffix + (name === 'agent_archive' ? '/archive' : ''), { method: name === 'agent_save' && suffix ? 'PATCH' : 'POST', body: JSON.stringify(input) });
            const profile = MyAgentProfileSchema.parse(result);
            const card = `<happy-agent>\n${JSON.stringify({ id: profile.id, name: profile.name, summary: profile.summary })}\n</happy-agent>`;
            return { content: [{ type: 'text', text: JSON.stringify(profile) + '\n\n' + card }] };
        } catch (error) {
            return { content: [{ type: 'text', text: error instanceof Error ? error.message : 'Agent 操作失败' }], isError: true };
        }
    };
}
