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

export interface SpawnSessionArgs {
    machineId: string;
    machine: Machine;
    /** Working directory on the machine; null/empty falls back to the home dir (~). */
    path: string | null;
    agent: NewSessionAgentType;
    /** Existing worktree absolute path, or null/'__none__' for no worktree. */
    worktreeKey: string | null;
    /** Per-session mode overrides selected before the first message. */
    permissionMode?: string;
    modelMode?: string;
    effortLevel?: string | null;
    /** Initial prompt to send into the freshly spawned session. */
    prompt: string;
    /** Image attachments to send with the initial message (claude-only). */
    images?: AttachmentPreview[];
}

/**
 * Inline session spawn used by the compose-first home so the user can type and
 * send without first opening /new. It mirrors the core of /new's `handleSend`
 * (resolve path → spawn → send initial message → navigate, with the
 * directory-creation approval round-trip). Worktree *creation* (the '__new__'
 * case) is still handled by /new; this hook is for the straightforward "machine
 * online, no new worktree" path. Image attachments ride along with the initial
 * message for agents that support them.
 */
export function useSpawnSession() {
    const navigateToSession = useNavigateToSession();
    const [sending, setSending] = React.useState(false);

    // Returns true when a session was created (so callers can clear their input).
    const spawn = React.useCallback(async (
        args: SpawnSessionArgs,
        approvedNewDirectoryCreation: boolean = false,
    ): Promise<boolean> => {
        const { machineId, machine, path, agent, worktreeKey, permissionMode, modelMode, effortLevel, prompt, images } = args;
        if (!isMachineOnline(machine)) {
            Modal.alert(t('common.error'), t('newSession.machineOffline'));
            return false;
        }

        setSending(true);
        try {
            const pathToUse = (path ?? '').trim() || '~';
            const absolutePath = resolveAbsolutePath(pathToUse, machine.metadata?.homeDir);

            // Existing worktree → spawn directly in it. Worktree *creation* ('__new__')
            // is handled by /new, not here (the caller falls back for that case).
            const spawnDirectory = (worktreeKey && worktreeKey !== '__none__' && worktreeKey !== '__new__')
                ? worktreeKey
                : absolutePath;

            const result = await machineSpawnNewSession({
                machineId,
                directory: spawnDirectory,
                approvedNewDirectoryCreation,
                agent,
            });

            switch (result.type) {
                case 'success':
                    await sync.refreshSessions();
                    const sessionStorage = storage.getState();
                    if (permissionMode !== undefined) {
                        sessionStorage.updateSessionPermissionMode(result.sessionId, permissionMode);
                    }
                    if (modelMode !== undefined) {
                        sessionStorage.updateSessionModelMode(result.sessionId, modelMode);
                    }
                    if (effortLevel !== undefined) {
                        sessionStorage.updateSessionEffortLevel(result.sessionId, effortLevel);
                    }
                    const attachments = images && images.length > 0 ? images : undefined;
                    if (prompt || attachments) {
                        await sync.sendMessage(result.sessionId, prompt, { source: 'new_session', attachments });
                    }
                    navigateToSession(result.sessionId);
                    return true;
                case 'requestToApproveDirectoryCreation': {
                    const approved = await Modal.confirm(
                        t('composeHome.createDirectoryTitle'),
                        t('composeHome.createDirectoryMessage', { path: result.directory }),
                        { cancelText: t('common.cancel'), confirmText: t('common.create') },
                    );
                    if (approved) {
                        return await spawn(args, true);
                    }
                    return false;
                }
                case 'error':
                    Modal.alert(t('common.error'), result.errorMessage);
                    return false;
            }
            return false;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to start session';
            Modal.alert(t('common.error'), message);
            return false;
        } finally {
            setSending(false);
        }
    }, [navigateToSession]);

    return { sending, spawn };
}
