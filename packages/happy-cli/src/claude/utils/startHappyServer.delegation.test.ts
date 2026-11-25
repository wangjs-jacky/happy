import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build } from 'esbuild';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiSessionClient } from '@/api/apiSession';
import type { DelegationResponse } from '@slopus/happy-wire';
import { launchDelegationDaemonSession } from '@/daemon/controlClient';
import { DELEGATION_MCP_TOOL_NAMES } from '@/delegation/mcpTools';
import { startHappyServer } from './startHappyServer';

vi.mock('@/daemon/controlClient', () => ({ launchIndependentDaemonSession: vi.fn(), launchDelegationDaemonSession: vi.fn() }));

const role = { id: 'writer', name: 'Writer', description: 'Write from supplied facts', agent: 'antigravity' as const, model: 'native-neon-code', autoDelegate: true, createdAt: 1, updatedAt: 1 };
const completed: DelegationResponse = { success: true, task: {
    id: 'task-one', parentSessionId: 'parent-one', childSessionId: 'actual-child', title: 'README', roleId: 'writer', roleName: 'Writer',
    agent: 'antigravity', model: 'native-neon-code', version: 2, status: 'completed', startedAt: 1, updatedAt: 4, finishedAt: 4,
    resultAvailable: true, prompt: 'Do not duplicate this prompt into the result', context: 'Private handoff text',
    history: [{ version: 1, prompt: 'Old prompt', status: 'completed', startedAt: 1, updatedAt: 2, result: { text: 'Old full draft' } }],
    result: { text: '# Actual revised draft', turnId: 'native:turn/two' },
} };

describe('parent-bound delegation MCP tools', () => {
    beforeEach(() => { vi.mocked(launchDelegationDaemonSession).mockReset(); });

    it('discovers all 15 tools over real HTTP and returns only the actual child link/current artifact', async () => {
        vi.mocked(launchDelegationDaemonSession).mockResolvedValue(completed);
        const context = { permissionMode: 'read-only' as const, appendSystemPrompt: 'Keep role and model separate' };
        const server = await startHappyServer({ sessionId: 'parent-one' } as ApiSessionClient, { delegationContext: () => context });
        const client = new Client({ name: 'delegation-http-test', version: '1' });
        try {
            await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
            const tools = (await client.listTools()).tools;
            expect(tools).toHaveLength(15);
            expect(server.toolNames).toHaveLength(15);
            for (const name of DELEGATION_MCP_TOOL_NAMES) {
                expect(tools.find(tool => tool.name === name)?.inputSchema.properties).not.toHaveProperty('parentSessionId');
            }
            const args = { requestId: 'write-request', roleId: 'writer', prompt: 'Write the README', context: 'Verified facts' };
            const response = await client.callTool({ name: 'delegate_task', arguments: args });
            expect(launchDelegationDaemonSession).toHaveBeenCalledWith('parent-one', { ...args, action: 'start', wait: true }, context);
            expect(response.isError).toBe(false);
            const text = JSON.stringify(response.content);
            expect(text).toContain('Actual revised draft');
            expect(text).toContain('<happy-session>');
            expect(text).toContain('actual-child');
            expect(text).not.toContain('Private handoff text');
            expect(text).not.toContain('Old full draft');
        } finally { await client.close(); server.stop(); }
    });

    it('binds CRUD/read/cancel to the parent and rejects spoofed scope, credentials, and ambiguous task identities', async () => {
        vi.mocked(launchDelegationDaemonSession).mockResolvedValue({ success: true, roles: [role] });
        const server = await startHappyServer({ sessionId: 'parent-one' } as ApiSessionClient);
        const client = new Client({ name: 'delegation-scope-test', version: '1' });
        try {
            await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
            const { createdAt: _created, updatedAt: _updated, ...inputRole } = role;
            await client.callTool({ name: 'agent_roles', arguments: { action: 'list' } });
            await client.callTool({ name: 'agent_roles', arguments: { action: 'save', role: inputRole } });
            await client.callTool({ name: 'agent_roles', arguments: { action: 'delete', roleId: 'writer' } });
            await client.callTool({ name: 'read_delegated_task', arguments: { taskId: 'task-one' } });
            await client.callTool({ name: 'cancel_delegated_task', arguments: { taskId: 'task-one' } });
            expect(launchDelegationDaemonSession).toHaveBeenNthCalledWith(1, 'parent-one', { action: 'roles-list' }, undefined);
            expect(launchDelegationDaemonSession).toHaveBeenNthCalledWith(2, 'parent-one', { action: 'roles-save', role: inputRole }, undefined);
            expect(launchDelegationDaemonSession).toHaveBeenNthCalledWith(3, 'parent-one', { action: 'roles-delete', roleId: 'writer' }, undefined);
            expect(launchDelegationDaemonSession).toHaveBeenNthCalledWith(4, 'parent-one', { action: 'read', taskId: 'task-one' }, undefined);
            expect(launchDelegationDaemonSession).toHaveBeenNthCalledWith(5, 'parent-one', { action: 'cancel', taskId: 'task-one' }, undefined);
            for (const input of [
                { name: 'agent_roles', arguments: { action: 'list', parentSessionId: 'other-parent' } },
                { name: 'agent_roles', arguments: { action: 'save', role: { ...inputRole, apiKey: 'forbidden' } } },
                { name: 'delegate_task', arguments: { requestId: 'request', prompt: 'Revise', roleId: 'writer', taskId: 'task-one' } },
                { name: 'delegate_task', arguments: { requestId: 'request', prompt: 'Missing role and task' } },
            ]) {
                const result = await client.callTool(input);
                expect(result.isError).toBe(true);
            }
            expect(launchDelegationDaemonSession).toHaveBeenCalledTimes(5);
        } finally { await client.close(); server.stop(); }
    });

    it('keeps the original identity on a wait timeout and forwards revisions without choosing a replacement role', async () => {
        vi.mocked(launchDelegationDaemonSession).mockResolvedValue({ ...completed, waitTimedOut: true,
            task: { ...completed.task!, status: 'running', resultAvailable: false, result: undefined, finishedAt: undefined } });
        const server = await startHappyServer({ sessionId: 'parent-one' } as ApiSessionClient);
        const client = new Client({ name: 'delegation-wait-test', version: '1' });
        try {
            await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
            const args = { requestId: 'same-revision-request', taskId: 'task-one', prompt: 'Shorten the introduction' };
            const response = await client.callTool({ name: 'delegate_task', arguments: args });
            expect(launchDelegationDaemonSession).toHaveBeenCalledWith('parent-one', { ...args, action: 'start', wait: true }, undefined);
            expect(launchDelegationDaemonSession).toHaveBeenCalledTimes(1);
            const text = JSON.stringify(response.content);
            expect(text).toContain('waitTimedOut');
            expect(text).toContain('task-one');
            expect(text).toContain('actual-child');
        } finally { await client.close(); server.stop(); }
    });

    it('discovers and invokes delegation through the real stdio bridge and HTTP server', async () => {
        vi.mocked(launchDelegationDaemonSession).mockResolvedValue(completed);
        const server = await startHappyServer({ sessionId: 'parent-one' } as ApiSessionClient);
        const cliRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
        const cache = join(cliRoot, 'node_modules', '.cache');
        await mkdir(cache, { recursive: true });
        const directory = await mkdtemp(join(cache, 'delegation-stdio-'));
        const entry = join(directory, 'bridge.mjs');
        const client = new Client({ name: 'delegation-stdio-test', version: '1' });
        try {
            // Bundle the production stdio entry only; no daemon or model worker is launched.
            await build({ entryPoints: [join(cliRoot, 'src/codex/happyMcpStdioBridge.ts')], outfile: entry,
                platform: 'node', format: 'esm', bundle: true, packages: 'external', logLevel: 'silent', tsconfig: join(cliRoot, 'tsconfig.json') });
            await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, '--url', server.url], cwd: cliRoot, stderr: 'pipe' }));
            const tools = (await client.listTools()).tools;
            expect(tools).toHaveLength(15);
            expect(tools.map(tool => tool.name)).toEqual(server.toolNames);
            const args = { requestId: 'stdio-request', roleId: 'writer', prompt: 'Write a grounded README' };
            const response = await client.callTool({ name: 'delegate_task', arguments: args });
            expect(launchDelegationDaemonSession).toHaveBeenCalledWith('parent-one', { ...args, action: 'start', wait: true }, undefined);
            expect(JSON.stringify(response.content)).toContain('Actual revised draft');
        } finally { await client.close(); server.stop(); await rm(directory, { recursive: true, force: true }); }
    }, 20_000);
});
