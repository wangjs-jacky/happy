import { beforeEach, expect, it, vi } from 'vitest';
import type { MyAgentProfile } from '@slopus/happy-wire';
const mocks = vi.hoisted(() => ({
    receipts: new Map<string, string>(),
    spawn: vi.fn(), update: vi.fn(), hydrate: vi.fn(), scan: vi.fn(), send: vi.fn(), project: vi.fn(), apply: vi.fn(), request: vi.fn(), get: vi.fn(),
    state: { settings: { recentMachinePaths: [] }, sessions: { s: { id: 's', metadataVersion: 1, metadata: { path: '/work', host: 'm' } } }, updateSessionModelMode: vi.fn(), updateSessionEffortLevel: vi.fn() } as any,
}));
vi.mock('react-native-mmkv', () => ({ MMKV: class { getString(key: string) { return mocks.receipts.get(key); } set(key: string, value: string) { mocks.receipts.set(key, value); } delete(key: string) { mocks.receipts.delete(key); } } }));
vi.mock('@/auth/accountRuntime', () => ({ accountStorageId: () => 'my-agent-starts' }));
vi.mock('@/sync/storage', () => ({ storage: { getState: () => mocks.state } }));
vi.mock('@/sync/ops', () => ({ machineListAgentSkills: mocks.scan, machineSpawnNewSession: mocks.spawn, sessionUpdateMetadata: mocks.update }));
vi.mock('@/sync/sync', () => ({ sync: { sendMessage: mocks.send, awaitLocalMessageProjection: mocks.project } }));
vi.mock('@/sync/ensureSessionHydratedWithRetry', () => ({ ensureSessionHydratedWithRetry: mocks.hydrate }));
vi.mock('@/sync/skills', () => ({ scanSkills: mocks.scan }));
vi.mock('@/hooks/useSpawnSession', () => ({ configureSpawnedSession: vi.fn() }));
vi.mock('@/text', () => ({ t: (key: string, args?: { names?: string }) => key === 'myAgents.missingSkills' ? `缺少 Skills：${args?.names}` : key }));
import { launchMyAgentSession } from './launch';
const profile = { id: 'agent-a', name: '军师', summary: '分析计划', instructions: '挑战假设', skills: [{ name: 'grilling', path: '/skills/grilling/SKILL.md', reason: '挑战假设' }], preferences: '', setupNotes: '', engine: 'codex', model: 'gpt-6.1-sol', effort: 'high', avatarId: 0, machineId: 'm', directory: '/work', sessions: [], archived: false, createdAt: 1, updatedAt: 2 } as MyAgentProfile;
const options = () => ({ api: { get: mocks.get, request: mocks.request } as any, profile, machine: { id: 'm', active: true } as any, text: '评估计划', isCurrent: () => true, onSpawned: vi.fn() });
beforeEach(() => {
    mocks.receipts.clear();
    mocks.send.mockResolvedValue({ type: 'queued', sessionId: 's', localIds: ['local-1'] });
    mocks.project.mockResolvedValue(true);
    vi.clearAllMocks(); mocks.state.applySessions = mocks.apply;
    mocks.get.mockResolvedValue(profile); mocks.spawn.mockResolvedValue({ type: 'success', sessionId: 's' });
    mocks.scan.mockResolvedValue([{ name: 'grilling', path: '/skills/grilling/SKILL.md' }]); mocks.hydrate.mockResolvedValue(true);
    mocks.update.mockImplementation(async (_id, metadata, _version, update) => ({ version: 2, metadata: update(metadata) }));
});
it('keeps a receipt for unknown remote outcomes so retries cannot spawn twice', async () => {
    mocks.spawn.mockResolvedValue({ type: 'error', outcomeUnknown: true, errorMessage: 'timeout' });
    await expect(launchMyAgentSession(options())).rejects.toThrow('避免重复创建');
    await expect(launchMyAgentSession(options())).rejects.toThrow('避免重复创建');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
});
it('blocks missing Skills and setup dependencies before spawning', async () => {
    mocks.scan.mockResolvedValue([]);
    await expect(launchMyAgentSession(options())).rejects.toThrow('缺少 Skills');
    expect(mocks.spawn).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ ...profile, setupNotes: '缺少必要插件' });
    await expect(launchMyAgentSession(options())).rejects.toThrow('缺少必要插件');
    expect(mocks.spawn).not.toHaveBeenCalled();
});
it('acknowledges encrypted role metadata and records the ordinary session before sending', async () => {
    expect(await launchMyAgentSession(options())).toBe('s');
    expect(mocks.apply).toHaveBeenCalledWith([expect.objectContaining({ metadata: expect.objectContaining({ myAgentId: 'agent-a' }) })]);
    expect(mocks.request).toHaveBeenCalledWith('/agent-a/sessions', expect.objectContaining({ method: 'POST' }));
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
    expect(mocks.state.updateSessionModelMode).toHaveBeenCalledWith('s', 'gpt-6.1-sol');
});
it('reuses an already spawned session after hydration failure and stops on account cancellation', async () => {
    mocks.hydrate.mockResolvedValue(false);
    const input = options();
    await expect(launchMyAgentSession(input)).rejects.toThrow('会话已创建');
    expect(input.onSpawned).toHaveBeenCalledWith('s');
    mocks.hydrate.mockResolvedValue(true);
    await launchMyAgentSession({ ...input, pendingSessionId: 's' });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    await expect(launchMyAgentSession({ ...input, isCurrent: () => false })).rejects.toThrow('取消');
    expect(mocks.send).toHaveBeenCalledTimes(1);
});

it('keeps the accepted message receipt so projection retries do not resend', async () => {
    mocks.project.mockResolvedValue(false);
    await expect(launchMyAgentSession(options())).rejects.toThrow('消息已发送');
    mocks.project.mockResolvedValue(true);
    expect(await launchMyAgentSession(options())).toBe('s');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
});
it('keeps the task and attachments unchanged when opening a saved assistant', async () => {
    const input = { ...options(), attachments: [{ id: 'image', name: 'ref.png' }] as any };
    await launchMyAgentSession(input);
    expect(mocks.spawn).toHaveBeenCalledWith(expect.objectContaining({ directory: '/work', agent: 'codex' }));
    expect(mocks.send).toHaveBeenCalledWith('s', '评估计划', expect.objectContaining({ attachments: input.attachments }));
});

it('uses the selected project or worktree instead of the profile default', async () => {
    await launchMyAgentSession({ ...options(), directory: '/selected-project/worktree' });
    expect(mocks.scan).toHaveBeenCalledWith('m', '/selected-project/worktree');
    expect(mocks.spawn).toHaveBeenCalledWith({ machineId: 'm', directory: '/selected-project/worktree', agent: 'codex' });
    expect(profile.directory).toBe('/work');
});

it('uses another online machine only after checking its installed Skills', async () => {
    const input = { ...options(), machine: { id: 'other', active: true } as any, directory: '/other-project' };
    mocks.hydrate.mockResolvedValueOnce(false);
    await expect(launchMyAgentSession(input)).rejects.toThrow('会话已创建');
    await launchMyAgentSession(input);
    expect(mocks.scan).toHaveBeenCalledWith('other', '/other-project');
    expect(mocks.scan.mock.invocationCallOrder[0]).toBeLessThan(mocks.spawn.mock.invocationCallOrder[0]);
    expect(mocks.spawn).toHaveBeenCalledWith({ machineId: 'other', directory: '/other-project', agent: 'codex' });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(profile.machineId).toBe('m');
});

it('blocks a selected machine with missing Skills without falling back to the saved machine', async () => {
    mocks.scan.mockResolvedValue([]);
    await expect(launchMyAgentSession({ ...options(), machine: { id: 'other', active: true } as any, directory: '/other-project' })).rejects.toThrow('缺少 Skills');
    expect(mocks.scan).toHaveBeenCalledWith('other', '/other-project');
    expect(mocks.spawn).not.toHaveBeenCalled();
});

it('retains the queued receipt when the user leaves during projection', async () => {
    let finish!: (value: boolean) => void;
    let current = true;
    mocks.project.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const running = launchMyAgentSession({ ...options(), isCurrent: () => current });
    const rejected = expect(running).rejects.toThrow('取消');
    await vi.waitFor(() => expect(mocks.project).toHaveBeenCalledTimes(1));
    current = false; finish(true);
    await rejected;
    expect(await launchMyAgentSession(options())).toBe('s');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(1);
});

it('keeps the original queue receipt for a cache-rebuild projection retry', async () => {
    const queued = { type: 'queued', sessionId: 's', localIds: ['receipt-cache'] };
    mocks.send.mockResolvedValue(queued); mocks.project.mockResolvedValueOnce(false);
    await expect(launchMyAgentSession(options())).rejects.toThrow('消息已发送');
    await launchMyAgentSession(options());
    expect(mocks.project).toHaveBeenLastCalledWith('s', ['receipt-cache'], queued);
    expect(mocks.send).toHaveBeenCalledTimes(1);
});
