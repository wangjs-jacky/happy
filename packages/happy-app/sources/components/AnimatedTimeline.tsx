import React from 'react';

export type AnimatedTimelineItemProps = {
    children: React.ReactNode;
    enabled: boolean;
    sessionId: string;
    active: boolean;
    hovered: boolean;
};

// Native and narrow layouts keep their existing row implementation. Motion is
// deliberately imported only by the .web implementation.
export function AnimatedTimelineProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}

export function AnimatedTimelineItem({ children }: AnimatedTimelineItemProps) {
    return <>{children}</>;
}
