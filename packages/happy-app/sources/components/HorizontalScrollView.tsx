import * as React from 'react';
import { Platform, ScrollView, ScrollViewProps, LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { GestureType } from 'react-native-gesture-handler';
import { DrawerGestureContext } from 'react-native-drawer-layout';

// Gesture-locked horizontal wheel scroll.
//
// The first wheel event of a trackpad gesture decides the axis: if horizontal
// movement clearly dominates (|deltaX| > |deltaY| * 2, min 3px) we lock to
// horizontal and drive scrollLeft ourselves; otherwise we lock to vertical and
// let every subsequent event pass through to the page. The lock resets after
// 150ms of idle (gesture ended). This avoids the two failure modes of pure
// per-event detection: slow vertical scrolls leaking tiny deltaX that gets
// misclassified, and fast diagonal swipes flickering between axes.
//
// Shift + wheel always converts vertical to horizontal (mouse wheel users).
// At scroll boundaries the event passes through so the page can scroll.
function useHorizontalWheelScroll() {
    const ref = React.useRef<ScrollView>(null);
    React.useEffect(() => {
        if (Platform.OS !== 'web' || !ref.current) return;
        const node = (ref.current as any)?.getScrollableNode?.() ?? (ref.current as any);
        if (!node || !node.addEventListener) return;

        let gestureAxis: 'h' | 'v' | null = null;
        let gestureTimer = 0;

        const handler = (e: WheelEvent) => {
            const el = node as HTMLElement;
            const maxScroll = el.scrollWidth - el.clientWidth;
            if (maxScroll <= 0) return;

            // Shift + wheel: convert vertical wheel to horizontal scroll.
            if (e.shiftKey && e.deltaY !== 0) {
                e.preventDefault();
                e.stopPropagation();
                el.scrollLeft += e.deltaY;
                return;
            }

            // Reset gesture lock after 150ms idle.
            window.clearTimeout(gestureTimer);
            gestureTimer = window.setTimeout(() => { gestureAxis = null; }, 150);

            // Decide axis on the first event of the gesture.
            if (gestureAxis === null) {
                const absX = Math.abs(e.deltaX);
                const absY = Math.abs(e.deltaY);
                gestureAxis = (absX > absY * 2 && absX > 3) ? 'h' : 'v';
            }

            if (gestureAxis === 'v') return;

            // Horizontal-locked: scroll the element, unless at boundary.
            const atStart = el.scrollLeft <= 0 && e.deltaX < 0;
            const atEnd = el.scrollLeft >= maxScroll - 1 && e.deltaX > 0;
            if (atStart || atEnd) return;

            e.preventDefault();
            e.stopPropagation();
            el.scrollLeft += e.deltaX;
        };
        node.addEventListener('wheel', handler, { passive: false });
        return () => {
            node.removeEventListener('wheel', handler);
            window.clearTimeout(gestureTimer);
        };
    }, []);
    return ref;
}

type Props = Omit<ScrollViewProps, 'horizontal'> & {
    /**
     * Native-only: horizontal scroll regions embedded inside other gestures can
     * ask their own native scroll recognizer to block those external gestures
     * while the content actually overflows. This keeps code blocks from handing
     * a horizontal drag to the markdown/page gesture around them.
     */
    blockExternalGestures?: GestureType[];
};

// Web: trackpad / mouse-wheel horizontal scroll with axis lock + boundary
// passthrough (the wheel handler above). Touch gestures don't exist here.
function WebHorizontalScrollView(props: Props) {
    const {
        showsHorizontalScrollIndicator = true,
        nestedScrollEnabled = true,
        blockExternalGestures: _blockExternalGestures,
        ...rest
    } = props;
    const ref = useHorizontalWheelScroll();
    return (
        <ScrollView
            ref={ref}
            horizontal
            showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
            nestedScrollEnabled={nestedScrollEnabled}
            {...rest}
        />
    );
}

// Native: a wide table renders inside the drawer's full-screen open gesture —
// SidebarNavigator sets `swipeEdgeWidth = windowWidth`, so the drawer's pan
// listens across the whole screen and was swallowing horizontal drags meant for
// the table, leaving the table unscrollable.
//
// Fix: give the table's own scroll gesture priority over the drawer, but ONLY
// while the content actually overflows horizontally. We grab the drawer's pan
// from DrawerGestureContext (react-native-drawer-layout, the engine under
// @react-navigation/drawer) and have the ScrollView's native gesture
// `blocksExternalGesture(drawerPan)`: a horizontal pan started on an
// overflowing table scrolls the table and the drawer stays put. Everywhere else
// — empty space, text, bubbles, and tables that already fit — the drawer's
// open-anywhere swipe is completely untouched.
//
// drawerPan is undefined when the table is rendered outside any drawer (e.g. a
// modal); then there's nothing to contend with and we just scroll normally.
function NativeHorizontalScrollView(props: Props) {
    const {
        showsHorizontalScrollIndicator = true,
        nestedScrollEnabled = true,
        blockExternalGestures,
        onLayout,
        onContentSizeChange,
        ...rest
    } = props;

    const drawerPan = React.useContext(DrawerGestureContext);

    // Only contend with the drawer when there's actually something to scroll, so
    // a narrow table that already fits keeps the open-anywhere swipe.
    const viewportWidth = React.useRef(0);
    const contentWidth = React.useRef(0);
    const [hasOverflow, setHasOverflow] = React.useState(false);

    const recomputeOverflow = React.useCallback(() => {
        const overflow = contentWidth.current > viewportWidth.current + 1;
        setHasOverflow((prev) => (prev !== overflow ? overflow : prev));
    }, []);

    const handleLayout = React.useCallback((e: LayoutChangeEvent) => {
        viewportWidth.current = e.nativeEvent.layout.width;
        recomputeOverflow();
        onLayout?.(e);
    }, [onLayout, recomputeOverflow]);

    const handleContentSizeChange = React.useCallback((w: number, h: number) => {
        contentWidth.current = w;
        recomputeOverflow();
        onContentSizeChange?.(w, h);
    }, [onContentSizeChange, recomputeOverflow]);

    // Gesture.Native() represents the ScrollView's own scroll recognizer. Only
    // attach blocking relations while overflowing, so non-scrollable content
    // leaves surrounding gestures untouched.
    const scrollGesture = React.useMemo(() => {
        const g = Gesture.Native();
        const externalGestures = [
            ...(drawerPan ? [drawerPan] : []),
            ...(blockExternalGestures ?? []),
        ];
        if (externalGestures.length > 0 && hasOverflow) {
            g.blocksExternalGesture(...externalGestures);
        }
        return g;
    }, [blockExternalGestures, drawerPan, hasOverflow]);

    return (
        <GestureDetector gesture={scrollGesture}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
                nestedScrollEnabled={nestedScrollEnabled}
                onLayout={handleLayout}
                onContentSizeChange={handleContentSizeChange}
                {...rest}
            />
        </GestureDetector>
    );
}

export function HorizontalScrollView(props: Props) {
    // Platform.OS is constant per build, so this branch is stable across renders.
    if (Platform.OS === 'web') {
        return <WebHorizontalScrollView {...props} />;
    }
    return <NativeHorizontalScrollView {...props} />;
}
