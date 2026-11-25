import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import type { ApiMachineClient } from '@/api/apiMachine';
import type { Metadata } from '@/api/types';
import { decodeBase64, decrypt } from '@/api/encryption';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import type { DelegationRole } from '@slopus/happy-wire';
import { createDaemonDelegationRuntime } from './delegationRuntime';
import { createDelegationService, DelegationDeliveryError, type DelegationSendOptions } from './delegation/service';
import { delegationLocalId } from './delegation/journal';
import type { TrackedSession } from './types';

const mocks = vi.hoisted(() => ({ createService: vi.fn(), waitForReady: vi.fn() }));
vi.mock('./delegation/service', async importOriginal => ({
    ...await importOriginal<typeof import('./delegation/service')>(),
    createDelegationService: mocks.createService,
}));
vi.mock('./delegation/journal', async importOriginal => ({
    ...await importOriginal<typeof import('./delegation/journal')>(),
    waitForDelegationReady: mocks.waitForReady,
}));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));
afterEach(() => { vi.restoreAllMocks(); mocks.createService.mockReset(); });

const binding = { taskId: 'task-one', parentSessionId: 'parent', version: 1, requestId: 'request-one', nonce: 'a'.repeat(64) };
const localId = delegationLocalId(binding);
const role: DelegationRole = { id: 'writer', name: 'Writer', description: 'Write documentation', agent: 'antigravity', model: 'Neon', autoDelegate: true, createdAt: 1, updatedAt: 1 };

async function fixture() {
    vi.spyOn(process, 'kill').mockReturnValue(true);
    vi.mocked(axios.post).mockReset().mockResolvedValue({ status: 200, data: {} });
    mocks.waitForReady.mockReset().mockResolvedValue(undefined);
    const tracked = (id: string, pid: number, byte: number): TrackedSession => ({ happySessionId: id, pid, startedBy: 'daemon',
        encryption: { encryptionKey: new Uint8Array(32).fill(byte), encryptionVariant: 'legacy', seq: 0, metadataVersion: 1, agentStateVersion: 1 } });
    const parent = tracked('parent', 111, 1); const child = tracked('child', 222, 2);
    const sessions = new Map([['parent', parent], ['child', child]]);
    const parentMetadata = { path: '/project', flavor: 'codex', machineId: 'machine', hostPid: 111, currentOperatingModeCode: 'read-only' } as Metadata;
    const childMetadata = { path: '/project', flavor: 'antigravity', machineId: 'machine', hostPid: 222,
        parentSessionId: 'parent', delegatedTask: { taskId: 'task-one', parentSessionId: 'parent' } } as Metadata;
    const snapshots = new Map([['parent', { metadata: parentMetadata, agentState: null }], ['child', { metadata: childMetadata, agentState: null }]]);
    const context = { agent: 'codex', permissionMode: 'yolo', appendSystemPrompt: 'Preserve source attribution.', hostPid: 111, lifecycleState: undefined as string | undefined };
    const prepare = { model: 'native-neon', effort: 'high' };
    const rpc = vi.fn(async (_id: string, _encryption: unknown, method: string, _body: unknown, _timeout?: number) => {
        if (method === 'delegation-context') return { ...context };
        if (method === 'delegation-prepare') return { ...prepare };
        if (method === 'delegation-abort') return { queuedCancelled: true };
        return { success: true };
    });
    const grant = vi.fn(async () => ({ grant: 'opaque-grant' }));
    const spawn = vi.fn(async (_options: SpawnSessionOptions): Promise<SpawnSessionResult> => ({ type: 'success', sessionId: 'child' }));
    const findSession = vi.fn((id: string) => sessions.get(id));
    const fetchSnapshot = vi.fn(async (id: string) => snapshots.get(id) ?? null);
    const coordinator = {} as Awaited<ReturnType<typeof createDelegationService>>;
    mocks.createService.mockResolvedValue(coordinator);
    const runtime = await createDaemonDelegationRuntime({ directory: '/private-test/delegation', machineId: 'machine', serverUrl: 'https://relay.test', token: 'relay-test-token',
        api: { createCodexSessionGrant: grant }, machineClient: { callSessionRpc: rpc as ApiMachineClient['callSessionRpc'] }, findSession, fetchSnapshot, spawn });
    expect(runtime).toBe(coordinator);
    const deps = (mocks.createService.mock.calls.at(-1)![0] as Parameters<typeof createDelegationService>[0]).deps;
    const options: DelegationSendOptions = { agent: 'antigravity', permissionMode: 'yolo', model: 'Neon', effort: 'high',
        appendSystemPrompt: context.appendSystemPrompt, delegation: binding, assertCurrent: vi.fn(async () => {}) };
    return { deps, sessions, parent, child, parentMetadata, childMetadata, context, prepare, rpc, grant, spawn, findSession, fetchSnapshot, options };
}

describe('daemon delegation runtime authorization and delivery', () => {
    it('uses the live worker permission context after checking fresh server ownership', async () => {
        const f = await fixture(); f.parentMetadata.codexAccountProfileId = 'account-one';
        expect(await f.deps.resolveParent('parent')).toMatchObject({ id: 'parent', agent: 'codex', directory: '/project', permissionMode: 'yolo',
            appendSystemPrompt: 'Preserve source attribution.', accountProfileId: 'account-one' });
        expect(f.fetchSnapshot).toHaveBeenCalledWith('parent', f.parent);
        expect(f.rpc).toHaveBeenCalledWith('parent', f.parent.encryption, 'delegation-context', {});
    });

    it.each(['machine', 'pid', 'archived', 'runtime-pid', 'runtime-agent', 'runtime-archived'])('rejects a parent whose %s identity changed', async condition => {
        const f = await fixture();
        if (condition === 'machine') f.parentMetadata.machineId = 'another-machine';
        if (condition === 'pid') f.parentMetadata.hostPid = 333;
        if (condition === 'archived') f.parentMetadata.lifecycleState = 'archived';
        if (condition === 'runtime-pid') f.context.hostPid = 333;
        if (condition === 'runtime-agent') f.context.agent = 'antigravity';
        if (condition === 'runtime-archived') f.context.lifecycleState = 'archiveRequested';
        await expect(f.deps.resolveParent('parent')).rejects.toThrow();
        expect(f.spawn).not.toHaveBeenCalled();
    });

    it('starts AGY without borrowing Codex authorization or relaxing the working directory gate', async () => {
        const f = await fixture(); const parent = await f.deps.resolveParent('parent');
        expect(await f.deps.spawn(parent, role, { HAPPY_DELEGATION_REPORTER: 'private-binding' })).toBe('child');
        expect(f.spawn).toHaveBeenCalledWith({ agent: 'antigravity', directory: '/project', parentSessionId: 'parent', approvedNewDirectoryCreation: false,
            environmentVariables: { HAPPY_DELEGATION_REPORTER: 'private-binding' } });
        expect(f.grant).not.toHaveBeenCalled();
    });

    it('requires a fresh Codex grant and pins a bound same-executor parent account', async () => {
        const f = await fixture(); f.parentMetadata.codexAccountProfileId = 'account-one';
        await f.deps.spawn(await f.deps.resolveParent('parent'), { ...role, agent: 'codex', model: 'gpt-code' }, {});
        expect(f.grant).toHaveBeenCalledWith({ machineId: 'machine' });
        expect(f.spawn).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', codexSessionGrant: 'opaque-grant', expectedCodexAccountProfileId: 'account-one' }));
    });

    it('permits local Codex login only for an explicit unbound account response with an unbound parent', async () => {
        const f = await fixture(); f.grant.mockRejectedValueOnce(Object.assign(new Error('unbound'), { code: 'codex-account-unbound' }));
        await f.deps.spawn(await f.deps.resolveParent('parent'), { ...role, agent: 'codex' }, {});
        expect(f.spawn).toHaveBeenCalledWith(expect.not.objectContaining({ codexSessionGrant: expect.anything() }));
    });

    it.each(['bound-unbound', 'unstructured-unbound', 'network', 'unauthorized'])('refuses local account fallback for %s', async condition => {
        const f = await fixture();
        if (condition === 'bound-unbound') f.parentMetadata.codexAccountProfileId = 'account-one';
        const error = condition === 'bound-unbound' ? Object.assign(new Error('unbound'), { code: 'codex-account-unbound' })
            : condition === 'unstructured-unbound' ? new Error('codex-account-unbound')
                : Object.assign(new Error(condition), { code: condition === 'network' ? 'ECONNRESET' : 'unauthorized' });
        f.grant.mockRejectedValueOnce(error);
        await expect(f.deps.spawn(await f.deps.resolveParent('parent'), { ...role, agent: 'codex' }, {})).rejects.toMatchObject({ notDispatched: true });
        expect(f.spawn).not.toHaveBeenCalled();
    });

    it('does not treat a malformed grant as permission to use a local account', async () => {
        const f = await fixture(); f.grant.mockResolvedValueOnce({ grant: '' });
        await expect(f.deps.spawn(await f.deps.resolveParent('parent'), { ...role, agent: 'codex' }, {})).rejects.toMatchObject({ notDispatched: true });
        expect(f.spawn).not.toHaveBeenCalled();
    });

    it('rejects an inequivalent permission transfer before grant creation or spawning', async () => {
        const f = await fixture(); f.context.permissionMode = 'read-only';
        await expect(f.deps.spawn(await f.deps.resolveParent('parent'), role, {})).rejects.toMatchObject({ notDispatched: true });
        expect(f.spawn).not.toHaveBeenCalled(); expect(f.grant).not.toHaveBeenCalled();
    });

    it('retains an unknown spawn outcome instead of misclassifying it as safe to repeat', async () => {
        const f = await fixture(); f.spawn.mockResolvedValueOnce({ type: 'error', errorMessage: 'Launch acknowledgement was lost' });
        await expect(f.deps.spawn(await f.deps.resolveParent('parent'), role, {})).rejects.toMatchObject({ notDispatched: false });
        const timeout = new Error('Spawn acknowledgement timeout'); f.spawn.mockRejectedValueOnce(timeout);
        await expect(f.deps.spawn(await f.deps.resolveParent('parent'), role, {})).rejects.toBe(timeout);
    });

    it('prepares AGY, revalidates the task, then delivers one child-encrypted message with the exact relay identity', async () => {
        const f = await fixture();
        expect(await f.deps.send('child', 'Verified draft request', localId, f.options)).toEqual(f.prepare);
        expect(mocks.waitForReady).toHaveBeenCalledWith({ descriptor: { directory: '/private-test/delegation/journal', taskId: binding.taskId,
            parentSessionId: binding.parentSessionId, nonce: binding.nonce }, sessionId: 'child', hostPid: 222 });
        expect(mocks.waitForReady.mock.invocationCallOrder[0]).toBeLessThan(f.rpc.mock.invocationCallOrder[0]);
        expect(f.rpc).toHaveBeenCalledWith('child', f.child.encryption, 'delegation-prepare', { model: 'Neon', effort: 'high', permissionMode: 'bypassPermissions' }, 30_000);
        expect(f.options.assertCurrent).toHaveBeenCalledTimes(1);
        expect(vi.mocked(axios.post)).toHaveBeenCalledTimes(1);
        const [url, body, config] = vi.mocked(axios.post).mock.calls[0];
        expect(url).toBe('https://relay.test/v3/sessions/child/messages');
        expect(config).toMatchObject({ timeout: 15_000, maxRedirects: 0, headers: { Authorization: 'Bearer relay-test-token' } });
        const message = (body as { messages: Array<{ localId: string; content: string }> }).messages[0];
        expect(message.localId).toBe(localId); expect(message.content).not.toContain('Verified draft request');
        expect(decrypt(f.child.encryption!.encryptionKey, 'legacy', decodeBase64(message.content))).toEqual({ role: 'user', content: { type: 'text', text: 'Verified draft request' },
            meta: { sentFrom: 'paws-delegation', permissionMode: 'bypassPermissions', permissionModeExplicit: true, model: 'native-neon', effort: 'high',
                appendSystemPrompt: 'Preserve source attribution.', delegation: binding } });
        expect(decrypt(f.parent.encryption!.encryptionKey, 'legacy', decodeBase64(message.content))).toBeNull();
    });

    it('also requires a native preparation ACK for Codex targets', async () => {
        const f = await fixture(); f.childMetadata.flavor = 'codex'; f.options.agent = 'codex'; f.options.model = 'gpt-code';
        f.prepare.model = 'gpt-code';
        expect(await f.deps.send('child', 'Review', localId, f.options)).toMatchObject({ model: 'gpt-code' });
        expect(f.rpc).toHaveBeenCalledWith('child', f.child.encryption, 'delegation-prepare', { model: 'gpt-code', effort: 'high', permissionMode: 'yolo' }, 30_000);
    });

    it.each(['machine', 'pid', 'agent', 'directory', 'task', 'parent', 'archived', 'application', 'sandbox', 'codex-account'])('does not deliver to a child with mismatched %s ownership', async condition => {
        const f = await fixture();
        if (condition === 'machine') f.childMetadata.machineId = 'another-machine';
        if (condition === 'pid') f.childMetadata.hostPid = 333;
        if (condition === 'agent') f.childMetadata.flavor = 'codex';
        if (condition === 'directory') f.childMetadata.path = '/another-project';
        if (condition === 'task') f.childMetadata.delegatedTask!.taskId = 'other-task';
        if (condition === 'parent') f.childMetadata.delegatedTask!.parentSessionId = 'other-parent';
        if (condition === 'archived') f.childMetadata.lifecycleState = 'archived';
        if (condition === 'application') f.childMetadata.application = { appId: 'app', bindingId: 'binding' };
        if (condition === 'sandbox') f.childMetadata.sandbox = { enabled: true } as Metadata['sandbox'];
        if (condition === 'codex-account') {
            f.options.agent = 'codex'; f.childMetadata.flavor = 'codex';
            f.parentMetadata.codexAccountProfileId = 'account-one'; f.childMetadata.codexAccountProfileId = 'another-account';
        }
        await expect(f.deps.send('child', 'Review', localId, f.options)).rejects.toMatchObject({ notDispatched: true });
        expect(f.rpc.mock.calls.filter(call => call[2] === 'delegation-prepare')).toHaveLength(0);
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('treats a preflight snapshot failure as definitely undelivered', async () => {
        const f = await fixture(); f.fetchSnapshot.mockRejectedValueOnce(new Error('snapshot unavailable'));
        await expect(f.deps.send('child', 'Review', localId, f.options)).rejects.toMatchObject({ notDispatched: true });
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('waits for native readiness locally before spending the relay RPC deadline', async () => {
        const f = await fixture(); let release!: () => void;
        mocks.waitForReady.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
        const sending = f.deps.send('child', 'Review', localId, f.options);
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(f.rpc).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
        release(); await sending;
        expect(f.rpc).toHaveBeenCalledTimes(1); expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('does not send an RPC or task when the native readiness deadline expires', async () => {
        const f = await fixture(); mocks.waitForReady.mockRejectedValueOnce(new Error('Native readiness timed out'));
        await expect(f.deps.send('child', 'Review', localId, f.options)).rejects.toMatchObject({ notDispatched: true });
        expect(f.rpc).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
    });

    it('rejects a child that changed while waiting for its native readiness receipt', async () => {
        const f = await fixture();
        mocks.waitForReady.mockImplementationOnce(async () => { f.sessions.set('child', { ...f.child, pid: 333 }); });
        await expect(f.deps.send('child', 'Review', localId, f.options)).rejects.toMatchObject({ notDispatched: true });
        expect(f.rpc).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
    });

    it('never posts task input when native preparation fails', async () => {
        const f = await fixture(); f.rpc.mockRejectedValueOnce(new Error('Neon is unavailable'));
        await expect(f.deps.send('child', 'Review', localId, f.options)).rejects.toMatchObject({ notDispatched: true, message: 'Neon is unavailable' });
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('preserves the coordinator cancellation error instead of wrapping its classification', async () => {
        const f = await fixture(); const cancelled = new DelegationDeliveryError('cancelled-before-dispatch');
        vi.mocked(f.options.assertCurrent).mockRejectedValueOnce(cancelled);
        await expect(f.deps.send('child', 'Review', localId, f.options)).rejects.toBe(cancelled);
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('checks the tracked child again after the asynchronous parent revalidation', async () => {
        const f = await fixture();
        vi.mocked(f.options.assertCurrent).mockImplementationOnce(async () => { f.sessions.set('child', { ...f.child, pid: 333 }); });
        await expect(f.deps.send('child', 'Review', localId, f.options)).rejects.toMatchObject({ notDispatched: true });
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('detects in-place child encryption identity changes during preparation', async () => {
        const f = await fixture();
        vi.mocked(f.options.assertCurrent).mockImplementationOnce(async () => { f.child.encryption!.encryptionKey.fill(3); });
        await expect(f.deps.send('child', 'Review', localId, f.options)).rejects.toMatchObject({ notDispatched: true });
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('leaves actual delivery timeouts uncertain and never retries or sends another local ID', async () => {
        const f = await fixture(); const timeout = new Error('Message ACK timeout'); vi.mocked(axios.post).mockRejectedValueOnce(timeout);
        await expect(f.deps.send('child', 'Review', localId, f.options)).rejects.toBe(timeout);
        expect(axios.post).toHaveBeenCalledTimes(1); expect(timeout).not.toHaveProperty('notDispatched');
    });

    it('cancels by the exact bound input and turn, and publishes through the encrypted parent RPC', async () => {
        const f = await fixture();
        expect(await f.deps.cancel('child', 'root-one', binding)).toEqual({ queuedCancelled: true });
        expect(f.rpc).toHaveBeenCalledWith('child', f.child.encryption, 'delegation-abort', { localId, expectedTurnId: 'root-one' });
        await f.deps.publish('parent', [], [role]);
        expect(f.rpc).toHaveBeenCalledWith('parent', f.parent.encryption, 'delegation-publish', { tasks: [], roles: [role] });
        f.sessions.delete('child'); expect(await f.deps.isChildAlive('child')).toBe(false);
    });
});
