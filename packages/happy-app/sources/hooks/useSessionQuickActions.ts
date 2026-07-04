import * as React from 'react';
import { useHappyAction } from '@/hooks/useHappyAction';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { Modal } from '@/modal';
import { machineResumeSession, sessionArchive, sessionKill, sessionDelete, sessionUpdateMetadata, forkAndSpawn, type ForkSource } from '@/sync/ops';
import { maybeCleanupWorktree } from '@/hooks/useWorktreeCleanup';
import { storage, useLocalSetting, useMachine, useSetting } from '@/sync/storage';
import { Machine, Session } from '@/sync/storageTypes';
import { sync } from '@/sync/sync';
import { resolveMessageModeMeta } from '@/sync/messageMeta';
import { t } from '@/text';
import { HappyError } from '@/utils/errors';
import { copySessionMetadataToClipboard, copySessionMetadataAndLogsToClipboard } from '@/utils/copySessionMetadataToClipboard';
import { useSessionStatus } from '@/utils/sessionUtils';
import { isMachineOnline } from '@/utils/machineUtils';
import { getSessionForkSource } from '@/utils/sessionFork';
import { useRouter } from 'expo-router';
import { useSession } from '@/sync/storage';
import { DuplicateSheet } from '@/components/DuplicateSheet';
import { hapticsSuccess } from '@/components/haptics';
import { getSessionName } from '@/utils/sessionUtils';
import { buildSessionQuickActionItems } from './sessionQuickActionItems';

export interface SessionActionItem {
    id: string;
    label: string;
    icon: string;
    onPress: () => void;
    destructive?: boolean;
}

interface UseSessionQuickActionsOptions {
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    onAfterCopySessionMetadata?: () => void;
    onSelectSession?: () => void;
}

type ResumeAvailability = {
    canResume: boolean;
    canShowResume: boolean;
    subtitle: string;
    message: string;
};

function getResumeAvailability(session: Session, machine: Machine | null | undefined, isConnected: boolean): ResumeAvailability {
    if (isConnected) {
        return {
            canResume: false,
            canShowResume: false,
            subtitle: '',
            message: '',
        };
    }

    const machineId = session.metadata?.machineId;
    if (!machineId) {
        const message = t('sessionInfo.resumeSessionMissingMachine');
        return {
            canResume: false,
            canShowResume: true,
            subtitle: message,
            message,
        };
    }

    const hasBackendResumeId = Boolean(session.metadata?.claudeSessionId || session.metadata?.codexThreadId);
    if (!hasBackendResumeId) {
        const message = t('sessionInfo.resumeSessionMissingBackendId');
        return {
            canResume: false,
            canShowResume: true,
            subtitle: message,
            message,
        };
    }

    if (!machine) {
        const message = t('sessionInfo.resumeSessionSameMachineOnly');
        return {
            canResume: false,
            canShowResume: true,
            subtitle: message,
            message,
        };
    }

    if (!isMachineOnline(machine)) {
        return {
            canResume: false,
            canShowResume: true,
            subtitle: t('sessionInfo.resumeSessionMachineOffline'),
            message: t('sessionInfo.resumeSessionMachineOffline'),
        };
    }

    return {
        canResume: true,
        canShowResume: true,
        subtitle: t('sessionInfo.resumeSessionSubtitle'),
        message: t('sessionInfo.resumeSessionSubtitle'),
    };
}

export function useSessionQuickActions(
    session: Session,
    options: UseSessionQuickActionsOptions = {},
) {
    const {
        onAfterArchive,
        onAfterDelete,
        onAfterCopySessionMetadata,
        onSelectSession,
    } = options;
    const router = useRouter();
    const navigateToSession = useNavigateToSession();
    const sessionStatus = useSessionStatus(session);
    const machineId = session.metadata?.machineId ?? '';
    const machine = useMachine(machineId);
    const devModeEnabled = useLocalSetting('devModeEnabled');
    const expResumeSession = useSetting('expResumeSession');
    const resumeAvailability = React.useMemo(
        () => expResumeSession ? getResumeAvailability(session, machine, sessionStatus.isConnected) : { canResume: false, canShowResume: false, subtitle: '', message: '' },
        [machine, session, sessionStatus.isConnected, expResumeSession],
    );

    // Fork eligibility — separate from resume because fork works on both
    // active AND inactive provider sessions. The user-facing toggle is the same
    // expResumeSession experiment so all three flows (resume / fork /
    // duplicate) ride a single switch on settings/features.
    const forkSource = React.useMemo(() => getSessionForkSource(session), [
        session.id,
        session.metadata?.flavor,
        session.metadata?.machineId,
        session.metadata?.path,
        session.metadata?.claudeSessionId,
        session.metadata?.codexThreadId,
    ]);
    const canFork = Boolean(
        expResumeSession
        && forkSource
        && machine
        && isMachineOnline(machine),
    );

    const openDetails = React.useCallback(() => {
        router.push(`/session/${session.id}/info`);
    }, [router, session.id]);

    const copySessionMetadata = React.useCallback(() => {
        void (async () => {
            const copied = await copySessionMetadataToClipboard(session);
            if (copied) {
                onAfterCopySessionMetadata?.();
            }
        })();
    }, [onAfterCopySessionMetadata, session]);

    const copySessionMetadataAndLogs = React.useCallback(() => {
        void (async () => {
            const copied = await copySessionMetadataAndLogsToClipboard(session);
            if (copied) {
                onAfterCopySessionMetadata?.();
            }
        })();
    }, [onAfterCopySessionMetadata, session]);

    const [resumingSession, performResume] = useHappyAction(async () => {
        if (!resumeAvailability.canResume) {
            throw new HappyError(resumeAvailability.message, false);
        }

        if (!machineId) {
            throw new HappyError(t('sessionInfo.resumeSessionMissingMachine'), false);
        }

        const modeMeta = resolveMessageModeMeta(session, storage.getState().settings);
        const result = await machineResumeSession({
            machineId,
            sessionId: session.id,
            model: modeMeta.model ?? undefined,
            permissionMode: modeMeta.permissionMode,
            effort: modeMeta.effort,
        });

        switch (result.type) {
            case 'success': {
                // Session reconnects to the same ID, so messages are preserved.
                // Refresh to pick up the updated session state.
                await sync.refreshSessions();

                if (session.permissionMode) {
                    storage.getState().updateSessionPermissionMode(result.sessionId, session.permissionMode);
                }
                if (session.modelMode) {
                    storage.getState().updateSessionModelMode(result.sessionId, session.modelMode);
                }
                if (session.effortLevel !== undefined) {
                    storage.getState().updateSessionEffortLevel(result.sessionId, session.effortLevel);
                }

                navigateToSession(result.sessionId);
                return;
            }
            case 'requestToApproveDirectoryCreation':
                throw new HappyError(t('sessionInfo.resumeSessionUnexpectedDirectoryPrompt'), false);
            case 'error':
                throw new HappyError(result.errorMessage, false);
        }
    });

    const [archivingSession, performArchive] = useHappyAction(async () => {
        await maybeCleanupWorktree(session.id, session.metadata?.path, session.metadata?.machineId);

        // Try to kill the CLI process; if it's already dead, force-archive via server
        const killResult = await sessionKill(session.id);
        if (!killResult.success) {
            await sessionArchive(session.id);
        }
        onAfterArchive?.();
    });

    const archiveSession = React.useCallback(() => {
        performArchive();
    }, [performArchive]);

    const [renamingSession, performRename] = useHappyAction(async () => {
        if (!session.metadata) {
            throw new HappyError(t('sessionInfo.renameSessionMissingMetadata'), false);
        }

        const currentTitle = getSessionName(session);
        const nextTitle = await Modal.prompt(
            t('sessionInfo.renameSession'),
            t('sessionInfo.renameSessionPrompt'),
            {
                defaultValue: currentTitle === t('session.newChat') ? '' : currentTitle,
                placeholder: t('sessionInfo.renameSessionPlaceholder'),
                cancelText: t('common.cancel'),
                confirmText: t('common.rename'),
            },
        );

        if (nextTitle === null) {
            return;
        }

        const trimmedTitle = nextTitle.trim();
        if (!trimmedTitle) {
            return;
        }

        await sessionUpdateMetadata(
            session.id,
            session.metadata,
            session.metadataVersion,
            metadata => ({
                ...metadata,
                summary: {
                    text: trimmedTitle,
                    updatedAt: Date.now(),
                },
            }),
        );
    });

    const renameSession = React.useCallback(() => {
        performRename();
    }, [performRename]);

    // Permanently delete a session. If it is still active, first try to stop
    // the CLI process so the server accepts the delete.
    const [deletingSession, performDelete] = useHappyAction(async () => {
        await maybeCleanupWorktree(session.id, session.metadata?.path, session.metadata?.machineId);

        // Best-effort kill in case the session reactivated between render and tap.
        if (sessionStatus.isConnected || session.active) {
            await sessionKill(session.id).catch(() => {});
        }

        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyError(result.message || t('sessionInfo.failedToDeleteSession'), false);
        }
        onAfterDelete?.();
    });

    const deleteSession = React.useCallback(() => {
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDelete,
                },
            ],
        );
    }, [performDelete]);

    const resumeSession = React.useCallback(() => {
        performResume();
    }, [performResume]);

    // Fork the session (no truncation) — copies the on-disk Claude JSONL
    // and spawns a fresh Happy session on the same machine. Works for
    // both active and inactive sessions; the source row stays untouched.
    const [forking, performFork] = useHappyAction(async () => {
        if (!canFork) {
            throw new HappyError(t('session.forkErrorMissingMetadata'), false);
        }
        if (!forkSource) {
            throw new HappyError(t('session.forkErrorMissingMetadata'), false);
        }
        const result = await forkAndSpawn(forkSource as ForkSource);
        if (result.type !== 'success') {
            throw new HappyError(result.type === 'error' ? result.errorMessage : t('session.forkErrorGeneric'), false);
        }
        hapticsSuccess();
        navigateToSession(result.sessionId);
    });

    const forkSession = React.useCallback(() => {
        performFork();
    }, [performFork]);

    const openDuplicateSheet = React.useCallback(() => {
        if (!canFork) return;
        Modal.show({
            component: DuplicateSheet,
            props: { sessionId: session.id },
        } as any);
    }, [canFork, session.id]);

    const canCopySessionMetadata = __DEV__ || devModeEnabled;

    const actionItems = React.useMemo<SessionActionItem[]>(() => {
        return buildSessionQuickActionItems({
            labels: {
                details: t('profile.details'),
                resume: t('sessionInfo.resumeSession'),
                rename: t('sessionInfo.renameSession'),
                fork: t('session.forkAction'),
                duplicate: t('session.duplicateAction'),
                copyMetadata: t('sessionInfo.copyMetadata'),
                copyMetadataAndLogs: t('sessionInfo.copyMetadata') + ' & Client Logs',
                archive: t('sessionInfo.archiveSession'),
                delete: t('sessionInfo.deleteSession'),
                select: t('sessionInfo.selectSession'),
            },
            callbacks: {
                openDetails,
                resumeSession,
                renameSession,
                forkSession,
                openDuplicateSheet,
                copySessionMetadata,
                copySessionMetadataAndLogs,
                archiveSession,
                deleteSession,
                selectSession: onSelectSession,
            },
            canShowResume: resumeAvailability.canShowResume,
            canFork,
            canCopySessionMetadata,
            sessionActive: session.active,
            canSelect: Boolean(onSelectSession),
        });
    }, [
        archiveSession,
        canCopySessionMetadata,
        canFork,
        copySessionMetadata,
        copySessionMetadataAndLogs,
        deleteSession,
        forkSession,
        openDetails,
        openDuplicateSheet,
        onSelectSession,
        renameSession,
        resumeAvailability.canShowResume,
        resumeSession,
        session.active,
    ]);

    const showActionAlert = React.useCallback(() => {
        const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' | 'destructive' | 'default' }> = actionItems.map(item => ({
            text: item.label,
            onPress: item.onPress,
            style: item.destructive ? 'destructive' as const : undefined,
        }));
        buttons.push({ text: t('common.cancel'), style: 'cancel' });
        Modal.alert('Session', undefined, buttons);
    }, [actionItems]);

    return {
        actionItems,
        showActionAlert,
        archiveSession,
        archivingSession,
        canArchive: session.active,
        canDelete: true,
        deleteSession,
        deletingSession,
        canCopySessionMetadata,
        canResume: resumeAvailability.canResume,
        canShowResume: resumeAvailability.canShowResume,
        canFork,
        copySessionMetadata,
        copySessionMetadataAndLogs,
        forkSession,
        forking,
        openDetails,
        openDuplicateSheet,
        renameSession,
        renamingSession,
        resumeSession,
        resumeSessionSubtitle: resumeAvailability.subtitle,
        resumingSession,
    };
}

/**
 * Lightweight hook for list items that only have a sessionId.
 * Returns a long-press handler that shows the action alert on mobile.
 */
export function useSessionActionAlert(sessionId: string) {
    const session = useSession(sessionId);
    const { showActionAlert } = useSessionQuickActions(session!, {});
    return session ? showActionAlert : undefined;
}
