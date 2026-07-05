import * as React from 'react';
import { Button, ContextMenu, Host } from '@expo/ui/swift-ui';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { Session } from '@/sync/storageTypes';
import { t } from '@/text';

interface SessionActionsNativeMenuProps {
    children: React.ReactNode;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    session: Session;
}

const iosSymbol = (name: string) =>
    name as unknown as React.ComponentProps<typeof Button>['systemImage'];

export function SessionActionsNativeMenu({
    children,
    onAfterArchive,
    onAfterDelete,
    session,
}: SessionActionsNativeMenuProps) {
    const {
        archiveSession,
        canArchive,
        canRegenerateTitle,
        deleteSession,
        canShowResume,
        openDetails,
        regenerateTitle,
        renameSession,
        resumeSession,
    } = useSessionQuickActions(session, {
        onAfterArchive,
        onAfterDelete,
    });

    return (
        <Host matchContents>
            <ContextMenu>
                <ContextMenu.Items>
                    <Button onPress={openDetails} systemImage={iosSymbol('info.circle')} label="Details" />
                    <Button onPress={renameSession} systemImage={iosSymbol('pencil')} label={t('sessionInfo.renameSession')} />
                    {canRegenerateTitle && (
                        <Button onPress={regenerateTitle} systemImage={iosSymbol('arrow.clockwise')} label={t('sessionInfo.regenerateTitle')} />
                    )}
                    {canArchive && (
                        <Button onPress={archiveSession} systemImage={iosSymbol('archivebox')} label={t('sessionInfo.archiveSession')} />
                    )}
                    <Button onPress={deleteSession} systemImage={iosSymbol('trash')} role="destructive" label={t('sessionInfo.deleteSession')} />
                    {canShowResume && (
                        <Button onPress={resumeSession} systemImage={iosSymbol('play.circle')} label="Resume" />
                    )}
                </ContextMenu.Items>
                <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
            </ContextMenu>
        </Host>
    );
}
