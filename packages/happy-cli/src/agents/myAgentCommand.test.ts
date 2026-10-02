import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMessageSchema } from '@/api/types';
import { createMyAgentToolHandler } from './myAgentTools';
import { declareMyAgentCommandCapability, getMyAgentCommand, loadBuiltInAgentBuilderSkill, prepareMyAgentMessage } from './myAgentCommand';

const paths = vi.hoisted(() => ({ root: '' }));
vi.mock('@/projectPath', () => ({ projectPath: () => paths.root }));
const root = fileURLToPath(new URL('../../', import.meta.url));
paths.root = root;
afterEach(() => { paths.root = root; });

describe('explicit /agent Skill binding', () => {
    it('declares command support without replacing unrelated capabilities or restored metadata', () => {
        let metadata: any = { path: '/project', host: 'test', myAgentId: 'saved-agent', capabilities: { regenerateTitle: true, codexCredentialRecovery: true } };
        declareMyAgentCommandCapability({ updateMetadata: update => { metadata = update(metadata); } });
        expect(metadata).toEqual({ path: '/project', host: 'test', myAgentId: 'saved-agent', capabilities: {
            myAgentCommand: true, regenerateTitle: true, codexCredentialRecovery: true,
        } });
    });
    it('loads the same packaged Skill through /agent and the MCP builder tool', async () => {
        const skill = loadBuiltInAgentBuilderSkill();
        expect(skill).toContain('name: agent-builder');
        const builder = createMyAgentToolHandler({ getMetadata: () => null, requestMyAgents: vi.fn() });
        expect((await builder('agent_builder', {})).content[0]).toMatchObject({ text: skill });
        expect(prepareMyAgentMessage({ content: { text: '/agent 创建狗头军师' } })).toMatchObject({
            prompt: expect.stringContaining(skill),
        });
    });

    it('retains explicit routing through schema validation and all continuation context', () => {
        const original = 'Earlier conversation:\n/agent quoted in history\nUser request: 修改军师，只改输出语言';
        const message = UserMessageSchema.parse({ role: 'user', content: { type: 'text', text: original },
            meta: { myAgentCommand: { request: '修改军师，只改输出语言' }, permissionMode: 'read-only', model: 'gpt-test' } });
        const result = prepareMyAgentMessage(message, { loadSkill: () => 'BUILT-IN SKILL' });
        expect(result).toHaveProperty('prompt');
        if (!result || !('prompt' in result)) throw new Error('Expected command');
        expect(result.prompt).toContain(original);
        expect(result.prompt).toContain('"修改军师，只改输出语言"');
        expect(message.content.text).toBe(original);
        expect(message.meta).toMatchObject({ permissionMode: 'read-only', model: 'gpt-test', myAgentCommand: { request: '修改军师，只改输出语言' } });
    });

    it.each(['ordinary text', 'quote /agent create', '/agents create', '/agent-builder create', '`/agent`'])('does not load or route ordinary text: %s', text => {
        const loadSkill = vi.fn();
        expect(prepareMyAgentMessage({ content: { text } }, { loadSkill })).toBeNull();
        expect(loadSkill).not.toHaveBeenCalled();
    });

    it('bare /agent asks for a request even when continuation history suggests a role', () => {
        const result = prepareMyAgentMessage({ content: { text: 'History: build me a strategist' },
            meta: { myAgentCommand: { request: '' } } }, { loadSkill: () => 'SKILL' });
        expect(result).toMatchObject({ prompt: expect.stringContaining('Do not save an Agent yet') });
        expect(getMyAgentCommand({ content: { text: ' \n/AGENT\t创建助手' } })).toEqual({ request: '创建助手' });
    });

    it('reports a missing bundled Skill instead of forwarding an unknown native slash command', async () => {
        paths.root = '/nonexistent-happy-cli-root';
        expect(prepareMyAgentMessage({ content: { text: '/agent create' } })).toMatchObject({
            error: expect.stringContaining('request was not executed'),
        });
        const builder = createMyAgentToolHandler({ getMetadata: () => null, requestMyAgents: vi.fn() });
        expect((await builder('agent_builder', {})).isError).toBe(true);
    });

    it.each(['Ask', 'OpenClaw'])('refuses unsupported %s before loading or executing the Skill', engine => {
        const loadSkill = vi.fn();
        expect(prepareMyAgentMessage({ content: { text: 'wrapped context' }, meta: { myAgentCommand: { request: 'create' } } },
            { unsupportedEngine: engine, loadSkill })).toMatchObject({ error: expect.stringContaining(`${engine} does not expose Happy's Agent tools`) });
        expect(loadSkill).not.toHaveBeenCalled();
    });
});
