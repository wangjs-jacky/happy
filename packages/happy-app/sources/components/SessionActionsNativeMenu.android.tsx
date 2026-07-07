import * as React from 'react';
import { DropdownMenu, DropdownMenuItem } from '@expo/ui/jetpack-compose';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { Session } from '@/sync/storageTypes';

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
    const { actionItems } = useSessionQuickActions(session, {
        onAfterArchive,
        onAfterDelete,
    });

    return (
        <DropdownMenu>
            <DropdownMenu.Items>
                {actionItems.map((action) => (
                    <DropdownMenuItem key={action.id} onClick={action.onPress}>
                        <DropdownMenuItem.Text>{action.label}</DropdownMenuItem.Text>
                    </DropdownMenuItem>
                ))}
            </DropdownMenu.Items>
            <DropdownMenu.Trigger>{children}</DropdownMenu.Trigger>
        </DropdownMenu>
    );
}
