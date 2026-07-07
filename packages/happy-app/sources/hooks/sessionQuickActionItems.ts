import type { SessionActionItem } from './useSessionQuickActions';

interface SessionQuickActionLabels {
    pin: string;
    unpin: string;
    details: string;
    resume: string;
    rename: string;
    regenerateTitle: string;
    fork: string;
    duplicate: string;
    copyMetadata: string;
    copyMetadataAndLogs: string;
    archive: string;
    delete: string;
    select?: string;
}

interface SessionQuickActionCallbacks {
    togglePinSession: () => void;
    openDetails: () => void;
    resumeSession: () => void;
    renameSession: () => void;
    regenerateTitle: () => void;
    forkSession: () => void;
    openDuplicateSheet: () => void;
    copySessionMetadata: () => void;
    copySessionMetadataAndLogs: () => void;
    archiveSession: () => void;
    deleteSession: () => void;
    selectSession?: () => void;
}

interface BuildSessionQuickActionItemsOptions {
    labels: SessionQuickActionLabels;
    callbacks: SessionQuickActionCallbacks;
    canShowResume: boolean;
    canRegenerateTitle: boolean;
    canFork: boolean;
    canCopySessionMetadata: boolean;
    sessionPinned: boolean;
    sessionActive: boolean;
    canSelect?: boolean;
}

export function buildSessionQuickActionItems({
    labels,
    callbacks,
    canShowResume,
    canRegenerateTitle,
    canFork,
    canCopySessionMetadata,
    sessionPinned,
    sessionActive,
    canSelect,
}: BuildSessionQuickActionItemsOptions): SessionActionItem[] {
    const items: SessionActionItem[] = [];

    if (canSelect && callbacks.selectSession && labels.select) {
        items.push({ id: 'select', icon: 'checkmark-circle-outline', label: labels.select, onPress: callbacks.selectSession });
    }

    items.push({
        id: sessionPinned ? 'unpin' : 'pin',
        icon: sessionPinned ? 'pin' : 'pin-outline',
        label: sessionPinned ? labels.unpin : labels.pin,
        onPress: callbacks.togglePinSession,
    });

    items.push(
        { id: 'details', icon: 'information-circle-outline', label: labels.details, onPress: callbacks.openDetails },
        { id: 'rename', icon: 'pencil-outline', label: labels.rename, onPress: callbacks.renameSession },
    );

    if (canRegenerateTitle) {
        items.push({ id: 'regenerate-title', icon: 'refresh-outline', label: labels.regenerateTitle, onPress: callbacks.regenerateTitle });
    }

    if (canShowResume) {
        items.push({ id: 'resume', icon: 'play-circle-outline', label: labels.resume, onPress: callbacks.resumeSession });
    }

    if (canFork) {
        items.push({ id: 'fork', icon: 'git-branch-outline', label: labels.fork, onPress: callbacks.forkSession });
        items.push({ id: 'duplicate', icon: 'time-outline', label: labels.duplicate, onPress: callbacks.openDuplicateSheet });
    }

    if (canCopySessionMetadata) {
        items.push({ id: 'copy-metadata', icon: 'bug-outline', label: labels.copyMetadata, onPress: callbacks.copySessionMetadata });
        items.push({ id: 'copy-metadata-and-logs', icon: 'document-text-outline', label: labels.copyMetadataAndLogs, onPress: callbacks.copySessionMetadataAndLogs });
    }

    if (sessionActive) {
        items.push({ id: 'archive', icon: 'archive-outline', label: labels.archive, onPress: callbacks.archiveSession, destructive: true });
    }
    items.push({ id: 'delete', icon: 'trash-outline', label: labels.delete, onPress: callbacks.deleteSession, destructive: true });

    return items;
}
