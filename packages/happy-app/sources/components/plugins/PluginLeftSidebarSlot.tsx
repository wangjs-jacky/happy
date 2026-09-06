import * as React from 'react';

import { RelationshipAdvisorSidebarHistory } from '../relationship-advisor/RelationshipAdvisorSidebarHistory';
import { usePluginSurfaceViews } from './usePluginSurfaceViews';

export const PluginLeftSidebarSlot = React.memo(function PluginLeftSidebarSlot({
    desktopDensity = false,
    fillAvailableSpace = false,
    onNavigate,
}: {
    desktopDensity?: boolean;
    fillAvailableSpace?: boolean;
    onNavigate: (path: string) => void;
}) {
    const views = usePluginSurfaceViews('left-sidebar');

    return views.map((view) => {
        if (view.componentId !== 'relationship-advisor-history') return null;
        return (
            <RelationshipAdvisorSidebarHistory
                desktopDensity={desktopDensity}
                fillAvailableSpace={fillAvailableSpace}
                key={`${view.pluginId}:${view.viewId}`}
                onNavigate={onNavigate}
            />
        );
    });
});
