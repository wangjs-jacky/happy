import React from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { useUnistyles } from 'react-native-unistyles';
import type { AnimatedTimelineItemProps } from './AnimatedTimeline';

// Adapted from React Bits Animated List's motion item + viewport visibility.
// Copyright (c) 2026 David Haz. See AnimatedTimeline.LICENSE.md.
// Keep FlatList virtualization and existing click/focus behavior; never select
// on hover or install the upstream demo's global arrow/Tab key listener.
const SeenItems = React.createContext<Set<string> | null>(null);

export function AnimatedTimelineProvider({ children }: { children: React.ReactNode }) {
    const [seen] = React.useState(() => new Set<string>());
    return <SeenItems.Provider value={seen}>{children}</SeenItems.Provider>;
}

export function AnimatedTimelineItem(props: AnimatedTimelineItemProps) {
    if (!props.enabled) return <>{props.children}</>;
    return <MotionItem {...props} />;
}

function MotionItem({ children, sessionId, active, hovered }: AnimatedTimelineItemProps) {
    const ref = React.useRef<HTMLDivElement>(null);
    const seen = React.useContext(SeenItems);
    const inView = useInView(ref, { amount: 0.1, once: true });
    const reducedMotion = useReducedMotion();
    const [alreadySeen] = React.useState(() => seen?.has(sessionId) ?? false);
    const { theme } = useUnistyles();
    const visible = alreadySeen || inView || !!reducedMotion;

    React.useEffect(() => {
        if (visible) seen?.add(sessionId);
    }, [seen, sessionId, visible]);

    return (
        <motion.div
            ref={ref}
            data-testid={`animated-timeline-${sessionId}`}
            initial={alreadySeen || reducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{
                opacity: visible ? 1 : 0,
                y: visible ? 0 : 6,
                backgroundColor: active ? theme.colors.surfaceSelected : hovered ? theme.colors.surfacePressed : theme.colors.groupped.background,
                borderColor: active ? theme.colors.divider : 'transparent',
            }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
            style={{ position: 'relative', margin: '0 8px', borderRadius: 10, border: '1px solid transparent' }}
        >
            <motion.div
                aria-hidden="true"
                animate={{ opacity: active ? 1 : 0, scaleY: active ? 1 : 0.4 }}
                transition={{ duration: reducedMotion ? 0 : 0.18 }}
                style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderRadius: 3, background: theme.colors.accent, pointerEvents: 'none' }}
            />
            {children}
        </motion.div>
    );
}
