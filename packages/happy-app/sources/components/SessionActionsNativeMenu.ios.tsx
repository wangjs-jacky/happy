import * as React from 'react';
import { Button, ContextMenu, Host } from '@expo/ui/swift-ui';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { Session } from '@/sync/storageTypes';

interface SessionActionsNativeMenuProps {
    children: React.ReactNode;
    onAfterArchive?: () => void;
    onAfterDelete?: () => void;
    session: Session;
}

const iosSymbol = (name: string) =>
    name as unknown as React.ComponentProps<typeof Button>['systemImage'];

const IONICON_TO_SF_SYMBOL: Record<string, string> = {
    'archive-outline': 'archivebox',
    'checkmark-circle-outline': 'checkmark.circle',
    'git-branch-outline': 'arrow.triangle.branch',
    'information-circle-outline': 'info.circle',
    'pencil-outline': 'pencil',
    'pin': 'pin.fill',
    'pin-outline': 'pin',
    'play-circle-outline': 'play.circle',
    'refresh-outline': 'arrow.clockwise',
    'time-outline': 'clock',
    'trash-outline': 'trash',
};

export function SessionActionsNativeMenu({
    children,
    onAfterArchive,
    onAfterDelete,
    session,
}: SessionActionsNativeMenuProps) {
    const { actionItems } = useSessionQuickActions(session, {
        onAfterArchive,
        onAfterDelete,
    });

    return (
        <Host matchContents>
            <ContextMenu>
                <ContextMenu.Items>
                    {actionItems.map((action) => (
                        <Button
                            key={action.id}
                            label={action.label}
                            onPress={action.onPress}
                            role={action.destructive ? 'destructive' : undefined}
                            systemImage={iosSymbol(IONICON_TO_SF_SYMBOL[action.icon] ?? 'circle')}
                        />
                    ))}
                </ContextMenu.Items>
                <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
            </ContextMenu>
        </Host>
    );
}
