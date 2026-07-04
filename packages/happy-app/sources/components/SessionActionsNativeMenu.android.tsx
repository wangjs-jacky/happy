import * as React from 'react';
import { DropdownMenu, DropdownMenuItem } from '@expo/ui/jetpack-compose';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

interface SessionActionsNativeMenuProps {
    children: React.ReactNode;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    session: Session;
}

export function SessionActionsNativeMenu({
    children,
    onAfterArchive,
    onAfterDelete,
    session,
}: SessionActionsNativeMenuProps) {
    const {
        archiveSession,
        canArchive,
        canDelete,
        deleteSession,
        canCopySessionMetadata,
        canShowResume,
        copySessionMetadata,
        openDetails,
        renameSession,
        resumeSession,
    } = useSessionQuickActions(session, {
        onAfterArchive,
        onAfterDelete,
    });

    return (
        <DropdownMenu>
            <DropdownMenu.Items>
                <DropdownMenuItem onClick={openDetails}>
                    <DropdownMenuItem.Text>Details</DropdownMenuItem.Text>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={renameSession}>
                    <DropdownMenuItem.Text>{t('sessionInfo.renameSession')}</DropdownMenuItem.Text>
                </DropdownMenuItem>
                {canArchive && (
                    <DropdownMenuItem onClick={archiveSession}>
                        <DropdownMenuItem.Text>{t('sessionInfo.archiveSession')}</DropdownMenuItem.Text>
                    </DropdownMenuItem>
                )}
                {canDelete && (
                    <DropdownMenuItem onClick={deleteSession}>
                        <DropdownMenuItem.Text>{t('sessionInfo.deleteSession')}</DropdownMenuItem.Text>
                    </DropdownMenuItem>
                )}
                {canShowResume && (
                    <DropdownMenuItem onClick={resumeSession}>
                        <DropdownMenuItem.Text>Resume</DropdownMenuItem.Text>
                    </DropdownMenuItem>
                )}
                {canCopySessionMetadata && (
                    <DropdownMenuItem onClick={copySessionMetadata}>
                        <DropdownMenuItem.Text>{t('sessionInfo.copyMetadata')}</DropdownMenuItem.Text>
                    </DropdownMenuItem>
                )}
            </DropdownMenu.Items>
            <DropdownMenu.Trigger>{children}</DropdownMenu.Trigger>
        </DropdownMenu>
    );
}
