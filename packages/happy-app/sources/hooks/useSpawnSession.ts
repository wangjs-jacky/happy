import * as React from 'react';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sync } from '@/sync/sync';
import { storage } from '@/sync/storage';
import { machineSpawnNewSession } from '@/sync/ops';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { isMachineOnline } from '@/utils/machineUtils';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import type { Machine } from '@/sync/storageTypes';
import type { NewSessionAgentType } from '@/sync/persistence';
import type { AttachmentPreview } from '@/sync/attachmentTypes';
import { organizeSession } from '@/sync/sidebarOrganization';
import { ensureSessionHydratedWithRetry } from '@/sync/ensureSessionHydratedWithRetry';

export interface SpawnSessionArgs {
    machineId: string;
    machine: Machine;
    /** Working directory on the machine; null/empty falls back to the home dir (~). */
    path: string | null;
    agent: NewSessionAgentType;
    /** Existing worktree absolute path, or null/'__none__' for no worktree. */
    worktreeKey: string | null;
    /** Per-session mode overrides selected before the first message. */
    permissionMode?: string | null;
    modelMode?: string | null;
    effortLevel?: string | null;
    fastMode?: boolean;
    /** Initial prompt to send into the freshly spawned session. */
    prompt: string;
    /** Image attachments to send with the initial message (claude-only). */
    images?: AttachmentPreview[];
    /** Extra environment passed to daemon-spawned agent process. */
    environmentVariables?: Record<string, string>;
    /** Optional sidebar List that should own the newly created session. */
    sidebarListId?: string | null;
}

export type SpawnSessionCoreResult =
    | { type: 'success'; sessionId: string }
    | { type: 'cancelled' }
    | { type: 'error'; message: string; sessionId?: string };

type PendingHydration = {
    sessionId: string;
    args: SpawnSessionArgs;
    retrying: boolean;
};

function configureSpawnedSession(sessionId: string, args: SpawnSessionArgs): void {
    const sessionStorage = storage.getState();
    if (args.permissionMode !== undefined) {
        sessionStorage.updateSessionPermissionMode(sessionId, args.permissionMode);
    }
    if (args.modelMode !== undefined) {
        sessionStorage.updateSessionModelMode(sessionId, args.modelMode);
    }
    if (args.effortLevel !== undefined) {
        sessionStorage.updateSessionEffortLevel(sessionId, args.effortLevel);
    }
    if (args.fastMode !== undefined) {
        sessionStorage.updateSessionFastMode(sessionId, args.fastMode);
    }
    if (args.sidebarListId) {
        sync.applySettings({
            sidebarOrganization: organizeSession(
                sessionStorage.settings.sidebarOrganization,
                sessionId,
                { listId: args.sidebarListId, tagIds: [] },
            ),
        });
    }
}

/**
 * Inline session spawn used by the compose-first home. The non-navigating core
 * resolves/spawns/configures a session, while `spawn` preserves the existing
 * send-once then navigate behavior for current callers.
 */
export function useSpawnSession() {
    const navigateToSession = useNavigateToSession();
    const [sending, setSending] = React.useState(false);
    const [hydrationError, setHydrationError] = React.useState<{ sessionId: string } | null>(null);
    const pendingHydration = React.useRef<PendingHydration | null>(null);
    const sendingOperations = React.useRef(0);
    const beginSending = React.useCallback(() => {
        sendingOperations.current += 1;
        if (sendingOperations.current === 1) setSending(true);
    }, []);
    const endSending = React.useCallback(() => {
        sendingOperations.current = Math.max(0, sendingOperations.current - 1);
        if (sendingOperations.current === 0) setSending(false);
    }, []);

    const spawnSession = React.useCallback(async (
        args: SpawnSessionArgs,
        approvedNewDirectoryCreation: boolean = false,
    ): Promise<SpawnSessionCoreResult> => {
        const { machineId, machine, path, agent, worktreeKey, environmentVariables } = args;
        if (!isMachineOnline(machine)) {
            const message = t('newSession.machineOffline');
            Modal.alert(t('common.error'), message);
            return { type: 'error', message };
        }

        beginSending();
        try {
            const pathToUse = (path ?? '').trim() || '~';
            const absolutePath = resolveAbsolutePath(pathToUse, machine.metadata?.homeDir);

            // Existing worktree → spawn directly in it. Worktree creation remains
            // owned by /new and is not supported by this straightforward core.
            const spawnDirectory = (worktreeKey && worktreeKey !== '__none__' && worktreeKey !== '__new__')
                ? worktreeKey
                : absolutePath;

            const runSpawn = async (approved: boolean): Promise<SpawnSessionCoreResult> => {
                const result = await machineSpawnNewSession({
                    machineId,
                    directory: spawnDirectory,
                    approvedNewDirectoryCreation: approved,
                    agent,
                    environmentVariables,
                });

                switch (result.type) {
                    case 'success': {
                        const hydrated = await ensureSessionHydratedWithRetry(result.sessionId);
                        if (!hydrated) {
                            return {
                                type: 'error',
                                message: 'newSession.sessionHydrationFailed',
                                sessionId: result.sessionId,
                            };
                        }
                        configureSpawnedSession(result.sessionId, args);
                        return { type: 'success', sessionId: result.sessionId };
                    }
                    case 'requestToApproveDirectoryCreation': {
                        const approved = await Modal.confirm(
                            t('composeHome.createDirectoryTitle'),
                            t('composeHome.createDirectoryMessage', { path: result.directory }),
                            { cancelText: t('common.cancel'), confirmText: t('common.create') },
                        );
                        return approved ? runSpawn(true) : { type: 'cancelled' };
                    }
                    case 'error':
                        Modal.alert(t('common.error'), result.errorMessage);
                        return { type: 'error', message: result.errorMessage };
                }
            };

            return await runSpawn(approvedNewDirectoryCreation);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start session';
            Modal.alert(t('common.error'), message);
            return { type: 'error', message };
        } finally {
            endSending();
        }
    }, [beginSending, endSending]);

    // Returns true when a session was created (so callers can clear their input).
    const spawn = React.useCallback(async (
        args: SpawnSessionArgs,
        approvedNewDirectoryCreation: boolean = false,
    ): Promise<boolean> => {
        if (pendingHydration.current) {
            return false;
        }
        beginSending();
        try {
            const result = await spawnSession(args, approvedNewDirectoryCreation);
            if (result.type !== 'success') {
                if (result.type === 'error'
                    && result.message === 'newSession.sessionHydrationFailed'
                    && result.sessionId) {
                    pendingHydration.current = {
                        sessionId: result.sessionId,
                        args,
                        retrying: false,
                    };
                    setHydrationError({ sessionId: result.sessionId });
                }
                return false;
            }

            const attachments = args.images && args.images.length > 0 ? args.images : undefined;
            if (args.prompt || attachments) {
                await sync.sendMessage(result.sessionId, args.prompt, { source: 'new_session', attachments });
            }
            navigateToSession(result.sessionId);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start session';
            Modal.alert(t('common.error'), message);
            return false;
        } finally {
            endSending();
        }
    }, [beginSending, endSending, navigateToSession, spawnSession]);

    const retryHydration = React.useCallback(async (): Promise<boolean> => {
        const pending = pendingHydration.current;
        if (!pending || pending.retrying) {
            return false;
        }

        pending.retrying = true;
        beginSending();
        try {
            const hydrated = await ensureSessionHydratedWithRetry(pending.sessionId);
            if (!hydrated) {
                return false;
            }

            configureSpawnedSession(pending.sessionId, pending.args);
            const attachments = pending.args.images && pending.args.images.length > 0
                ? pending.args.images
                : undefined;
            if (pending.args.prompt || attachments) {
                await sync.sendMessage(pending.sessionId, pending.args.prompt, {
                    source: 'new_session',
                    attachments,
                });
            }

            pendingHydration.current = null;
            setHydrationError(null);
            navigateToSession(pending.sessionId);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start session';
            Modal.alert(t('common.error'), message);
            return false;
        } finally {
            pending.retrying = false;
            endSending();
        }
    }, [beginSending, endSending, navigateToSession]);

    return { sending, hydrationError, retryHydration, spawnSession, spawn };
}
