import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ProfileService } from '../src/group-chat/profiles.js';
import { AccountAccess } from '../src/server/account-access.js';
import { createAccountServer } from '../src/server/account-server.js';
import { TestOnlySdk } from './fake-sdk.js';
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0; });
const definition = { requestId: 'create-1', name: '军师', summary: '分析想法与决策', instructions: '先给判断，再问必要的问题。', skills: [{ name: 'grilling', path: '/skills/grilling/SKILL.md', reason: '挑战计划里的隐含假设' }], preferences: '直接表达', machineId: 'm', directory: '/work' };
async function service() {
    const dir = await mkdtemp(join(tmpdir(), 'my-agents-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    return { dir, profiles: await ProfileService.create(dir) };
}
it('persists Skills, explicit preferences, sessions and archive state across restart', async () => {
    const { profiles, dir } = await service();
    const agent = await profiles.saveMyAgent(definition);
    await profiles.recordSession(agent.id, { sessionId: 'session-1', title: '评估我的计划' });
    await profiles.recordSession(agent.id, { sessionId: 'session-1', title: '重复写入' });
    await profiles.archiveMyAgent(agent.id, { expectedUpdatedAt: agent.updatedAt, archived: true });
    const restored = await ProfileService.create(dir);
    expect(restored.get(agent.id)).toMatchObject({ skills: definition.skills, preferences: '直接表达', archived: true, sessions: [{ sessionId: 'session-1', title: '评估我的计划' }] });
    expect(restored.get(agent.id).sessions).toHaveLength(1);
});
it('deduplicates retried creates and rejects changed payloads and concurrent stale edits', async () => {
    const { profiles } = await service();
    const [first, retried] = await Promise.all([profiles.saveMyAgent(definition), profiles.saveMyAgent(definition)]);
    expect(retried.id).toBe(first.id);
    await expect(profiles.saveMyAgent({ ...definition, name: '另一军师' })).rejects.toMatchObject({ status: 409 });
    const results = await Promise.allSettled([
        profiles.saveMyAgent({ ...definition, requestId: 'edit-a', expectedUpdatedAt: first.updatedAt, instructions: '修改 A' }, first.id),
        profiles.saveMyAgent({ ...definition, requestId: 'edit-b', expectedUpdatedAt: first.updatedAt, instructions: '修改 B' }, first.id),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(profiles.get(first.id).instructions).toBe('修改 A');
});
it('preserves extended fields when editing through the existing Party manager', async () => {
    const { profiles } = await service();
    const agent = await profiles.saveMyAgent(definition);
    await profiles.update(agent.id, { name: agent.name, instructions: '来自旧管理器的调整' });
    expect(profiles.get(agent.id)).toMatchObject({ skills: definition.skills, preferences: definition.preferences });
    await expect(profiles.update(agent.id, { name: agent.name, instructions: '过期职责', expectedUpdatedAt: agent.updatedAt })).rejects.toMatchObject({ status: 409 });
    expect(profiles.get(agent.id).instructions).toBe('来自旧管理器的调整');
    await expect(profiles.saveMyAgent({ ...definition, requestId: 'bad', name: '坏路径', skills: [{ name: 'x', reason: 'x', path: 'relative/SKILL.md' }] })).rejects.toMatchObject({ status: 400 });
});
it('uses verified Paws bearers for catalog only, shares the Party catalog, and isolates accounts', async () => {
    const { dir } = await service();
    const access = new AccountAccess('http://relay.test', 'master', async (_url, init) => {
        const token = new Headers(init?.headers).get('authorization')?.slice(7);
        return token === 'A' || token === 'B' ? Response.json({ id: token }) : new Response('', { status: 401 });
    });
    const server = await createAccountServer({ dataDir: join(dir, 'accounts'), masterKey: 'master', serverUrl: 'http://relay.test', staticDir: dir, access, sdkFactory: () => new TestOnlySdk() });
    cleanup.push(() => server.close());
    const call = (path: string, token: string, method = 'GET', data?: unknown) => fetch(server.url + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    expect((await call('/api/my-agents', 'master')).status).toBe(401);
    const response = await call('/api/my-agents', 'A', 'POST', definition);
    expect(response.status).toBe(200);
    const created = await response.json();
    expect((await call(`/api/my-agents/${created.id}`, 'B')).status).toBe(404);
    expect((await call(`/api/my-agents/${created.id}`, 'B', 'PATCH', { ...definition, expectedUpdatedAt: created.updatedAt })).status).toBe(404);
    expect((await call(`/api/my-agents/${created.id}/sessions`, 'B', 'POST', { sessionId: 'stolen' })).status).toBe(404);
    expect((await call('/api/paws/machines', 'A')).status).toBe(401);
    const ticket = access.issue({ id: 'A', name: 'A' }, 'A');
    const partyToken = access.exchange(ticket).token;
    expect((await (await call('/api/group-chat/agents', partyToken)).json()).agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, skills: definition.skills })]));
    expect((await (await call('/api/my-agents', 'B')).json()).agents).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
});
