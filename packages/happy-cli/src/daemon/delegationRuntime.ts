import axios from 'axios';
import { join } from 'node:path';
import { z } from 'zod';
import type { ApiClient } from '@/api/api';
import type { ApiMachineClient } from '@/api/apiMachine';
import type { AgentState, Metadata } from '@/api/types';
import { encodeBase64, encrypt } from '@/api/encryption';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import type { TrackedSession } from './types';
import { createDelegationService, DelegationDeliveryError } from './delegation/service';
import { delegationLocalId, waitForDelegationReady } from './delegation/journal';
import { delegationPermissionMode } from './delegationPermissions';

const runtimeContextSchema = z.object({ agent: z.enum(['codex', 'antigravity']), permissionMode: z.string(),
    appendSystemPrompt: z.string().optional(), hostPid: z.number().int().positive(), lifecycleState: z.string().optional() });
const nativeCode = z.string().trim().min(1).max(256).refine(value => !/[\u0000-\u001f]/.test(value));
const preparedSchema = z.object({ model: nativeCode, effort: nativeCode.optional() });
const grantSchema = z.object({ grant: z.string().min(1).max(8192).refine(value => !/\s/.test(value)) });
const archived = (metadata: Metadata) => ['archived', 'archiveRequested'].includes(metadata.lifecycleState ?? '');
const undelivered = (error: unknown, fallback: string) => error instanceof DelegationDeliveryError ? error
    : new DelegationDeliveryError(error instanceof Error ? error.message : fallback);

export async function createDaemonDelegationRuntime(input: {
    directory: string; machineId: string; serverUrl: string; token: string;
    api: Pick<ApiClient, 'createCodexSessionGrant'>; machineClient: Pick<ApiMachineClient, 'callSessionRpc'>;
    findSession(id: string): TrackedSession | undefined;
    fetchSnapshot(id: string, tracked: TrackedSession): Promise<{ metadata: Metadata; agentState: AgentState | null } | null>;
    spawn(options: SpawnSessionOptions): Promise<SpawnSessionResult>;
}) {
    function ownedSession(id: string): TrackedSession & { encryption: NonNullable<TrackedSession['encryption']> } {
        const tracked = input.findSession(id);
        if (!tracked?.encryption || tracked.happySessionId !== id || !Number.isSafeInteger(tracked.pid) || tracked.pid <= 0) throw new Error('The session is not owned by this daemon');
        try { process.kill(tracked.pid, 0); } catch { throw new Error('The session worker is no longer running'); }
        // Do not let in-place tracking updates change an identity captured before an await.
        return { ...tracked, encryption: { ...tracked.encryption, encryptionKey: new Uint8Array(tracked.encryption.encryptionKey) } };
    }
    function assertSameWorker(id: string, expected: ReturnType<typeof ownedSession>): void {
        const current = ownedSession(id);
        if (current.pid !== expected.pid || current.encryption.encryptionVariant !== expected.encryption.encryptionVariant
            || !Buffer.from(current.encryption.encryptionKey).equals(Buffer.from(expected.encryption.encryptionKey))) {
            throw new Error('The delegated worker changed during preparation');
        }
    }
    return createDelegationService({ directory: input.directory, deps: {
        async resolveParent(id) {
            const tracked = ownedSession(id);
            const snapshot = await input.fetchSnapshot(id, tracked);
            if (!snapshot || !['codex', 'antigravity'].includes(snapshot.metadata.flavor ?? '')
                || snapshot.metadata.machineId !== input.machineId || snapshot.metadata.hostPid !== tracked.pid
                || archived(snapshot.metadata)) throw new Error('The parent session is unavailable or changed');
            const runtime = runtimeContextSchema.parse(await input.machineClient.callSessionRpc(id, tracked.encryption, 'delegation-context', {}));
            if (runtime.hostPid !== tracked.pid || runtime.agent !== snapshot.metadata.flavor
                || ['archived', 'archiveRequested'].includes(runtime.lifecycleState ?? '')) throw new Error('The parent worker identity changed');
            return { id, agent: runtime.agent, directory: snapshot.metadata.path, permissionMode: runtime.permissionMode,
                appendSystemPrompt: runtime.appendSystemPrompt, accountProfileId: snapshot.metadata.codexAccountProfileId,
                application: snapshot.metadata.application, sandbox: Boolean(snapshot.metadata.sandbox?.enabled), delegated: Boolean(snapshot.metadata.delegatedTask) };
        },
        async spawn(parent, role, environment) {
            // Validate transfer before creating a process. Model selection occurs
            // after its reported session ID has been durably bound by the service.
            let grant: { grant: string } | undefined;
            try {
                delegationPermissionMode(parent, role.agent);
                if (role.agent === 'codex') {
                    try { grant = grantSchema.parse(await input.api.createCodexSessionGrant({ machineId: input.machineId })); }
                    catch (error) {
                        // Only an explicit unbound response permits the machine's local login.
                        // A network/auth failure or an existing parent binding never does.
                        if (parent.accountProfileId || (error as { code?: unknown })?.code !== 'codex-account-unbound') throw error;
                    }
                }
            } catch (error) { throw undelivered(error, 'Delegation launch authorization was not confirmed'); }
            const result = await input.spawn({ agent: role.agent, directory: parent.directory, parentSessionId: parent.id,
                approvedNewDirectoryCreation: false, environmentVariables: environment,
                ...(grant ? { codexSessionGrant: grant.grant } : {}),
                ...(role.agent === 'codex' && parent.agent === 'codex' && parent.accountProfileId ? { expectedCodexAccountProfileId: parent.accountProfileId } : {}),
            });
            if (result.type !== 'success') throw new DelegationDeliveryError(result.type === 'error' ? result.errorMessage : 'The delegated working directory must already exist', result.type !== 'error' || result.notDispatched === true);
            return result.sessionId;
        },
        async send(childId, prompt, localId, options) {
            let child: ReturnType<typeof ownedSession>;
            let mode: string;
            let prepared: z.infer<typeof preparedSchema>;
            try {
                if (localId !== delegationLocalId(options.delegation)) throw new Error('Delegated input identity changed');
                child = ownedSession(childId);
                const parent = ownedSession(options.delegation.parentSessionId);
                const snapshot = await input.fetchSnapshot(childId, child);
                const parentSnapshot = await input.fetchSnapshot(options.delegation.parentSessionId, parent);
                if (!snapshot || !parentSnapshot || !['codex', 'antigravity'].includes(parentSnapshot.metadata.flavor ?? '')
                    || parentSnapshot.metadata.machineId !== input.machineId || parentSnapshot.metadata.hostPid !== parent.pid || archived(parentSnapshot.metadata)
                    || snapshot.metadata.flavor !== options.agent || snapshot.metadata.machineId !== input.machineId || snapshot.metadata.hostPid !== child.pid
                    || archived(snapshot.metadata) || snapshot.metadata.application || snapshot.metadata.sandbox?.enabled
                    || snapshot.metadata.path !== parentSnapshot.metadata.path
                    || snapshot.metadata.delegatedTask?.taskId !== options.delegation.taskId
                    || snapshot.metadata.delegatedTask?.parentSessionId !== options.delegation.parentSessionId
                    || (options.agent === 'codex' && parentSnapshot.metadata.flavor === 'codex' && parentSnapshot.metadata.codexAccountProfileId
                        && snapshot.metadata.codexAccountProfileId !== parentSnapshot.metadata.codexAccountProfileId)) {
                    throw new Error('The delegated session identity or ownership changed');
                }
                mode = delegationPermissionMode({ agent: parentSnapshot.metadata.flavor as 'codex' | 'antigravity', permissionMode: options.permissionMode }, options.agent);
                await waitForDelegationReady({ descriptor: { directory: join(input.directory, 'journal'), taskId: options.delegation.taskId,
                    parentSessionId: options.delegation.parentSessionId, nonce: options.delegation.nonce }, sessionId: childId, hostPid: child.pid });
                assertSameWorker(childId, child);
                prepared = preparedSchema.parse(await input.machineClient.callSessionRpc(childId, child.encryption, 'delegation-prepare',
                    { model: options.model, ...(options.effort ? { effort: options.effort } : {}), permissionMode: mode }, 30_000));
            } catch (error) { throw undelivered(error, 'Model configuration was not confirmed'); }
            // Preserve the coordinator's cancellation/exit classification.
            await options.assertCurrent();
            let content: string;
            try {
                assertSameWorker(childId, child);
                content = encodeBase64(encrypt(child.encryption.encryptionKey, child.encryption.encryptionVariant, {
                    role: 'user', content: { type: 'text', text: prompt }, meta: {
                        sentFrom: 'paws-delegation', permissionMode: mode, permissionModeExplicit: true,
                        model: prepared.model, ...(prepared.effort ? { effort: prepared.effort } : {}),
                        ...(options.appendSystemPrompt ? { appendSystemPrompt: options.appendSystemPrompt } : {}), delegation: options.delegation,
                    },
                }));
            } catch (error) { throw undelivered(error, 'Delegated input could not be encrypted'); }
            // One delivery with a stable relay localId. An uncertain response is
            // persisted by the coordinator; never retry it with a new identity.
            await axios.post(`${input.serverUrl}/v3/sessions/${encodeURIComponent(childId)}/messages`,
                { messages: [{ localId, content }] }, { headers: { Authorization: `Bearer ${input.token}` }, timeout: 15_000, maxRedirects: 0 });
            return prepared;
        },
        async cancel(childId, expectedTurnId, binding) {
            if (!binding) throw new Error('Cancellation requires the original delegated input identity');
            const child = ownedSession(childId);
            return input.machineClient.callSessionRpc<{ queuedCancelled?: boolean }>(childId, child.encryption, 'delegation-abort',
                { localId: delegationLocalId(binding), ...(expectedTurnId ? { expectedTurnId } : {}) });
        },
        isChildAlive(id) { try { ownedSession(id); return true; } catch { return false; } },
        async publish(parentId, tasks, roles) {
            const parent = ownedSession(parentId);
            await input.machineClient.callSessionRpc(parentId, parent.encryption, 'delegation-publish', { tasks, roles });
        },
    } });
}
