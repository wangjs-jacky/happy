import * as React from 'react';
import { Platform, ScrollView, ScrollViewProps, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { DrawerGestureContext } from 'react-native-drawer-layout';
import { useSharedValue } from 'react-native-reanimated';

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

type Props = Omit<ScrollViewProps, 'horizontal'>;

// Web: trackpad / mouse-wheel horizontal scroll with axis lock + boundary
// passthrough (the wheel handler above). Touch gestures don't exist here.
function WebHorizontalScrollView(props: Props) {
    const {
        showsHorizontalScrollIndicator = true,
        nestedScrollEnabled = true,
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

// Native: a wide table lives inside the drawer's full-screen open gesture —
// SidebarNavigator sets `swipeEdgeWidth = windowWidth`, so the drawer's pan
// listens across the whole screen. Worse, that pan activates SYMMETRICALLY
// (`activeOffsetX([-5, 5])` in react-native-drawer-layout), so a closed left
// drawer grabs BOTH left- and right-going swipes — a plain native ScrollView
// never gets to scroll, and an unconditional `blocksExternalGesture` made the
// table win even when it had nothing left to scroll (dead zones at the edges).
//
// We instead arbitrate ONCE at the start of each drag with a manual-activation
// Pan, using only two signals — swipe direction and current scrollLeft — which
// fully disambiguate intent (there is no genuinely ambiguous case):
//
//   • vertical drag                  → yield (FlatList scrolls; drawer self-fails via failOffsetY)
//   • table doesn't overflow         → yield (nothing to scroll → keep the open-anywhere drawer)
//   • swipe right while at left edge  → yield (table can't go further left → open the drawer)
//   • everything else                → claim (scroll the table, block the drawer)
//
// "Claim" blocks the drawer and runs simultaneously with the ScrollView's own
// native recognizer, so native momentum / bounce is preserved — we never drive
// the scroll by hand. The owner is decided once per drag (RNGH can't transfer
// an active gesture mid-drag); at an edge you lift and swipe again, the standard
// native nested-scroll convention.
//
// drawerPan is undefined when rendered outside any drawer (e.g. a modal); then
// there's nothing to contend with and we just scroll normally.

const EDGE_EPS = 1;       // px tolerance for treating the table as "at the left edge"
const DECIDE_OFFSET = 6;  // px of finger travel before we commit the drag to an owner

function NativeHorizontalScrollView(props: Props) {
    const {
        showsHorizontalScrollIndicator = true,
        nestedScrollEnabled = true,
        onLayout,
        onContentSizeChange,
        onScroll,
        scrollEventThrottle,
        ...rest
    } = props;

    const drawerPan = React.useContext(DrawerGestureContext);

    // Shared values are read inside the gesture worklet on the UI thread.
    const scrollX = useSharedValue(0);
    const canScroll = useSharedValue(false);
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);
    const decided = useSharedValue(false);

    // Only contend with the drawer when there's actually something to scroll, so
    // a narrow table that already fits keeps the open-anywhere swipe.
    const viewportWidth = React.useRef(0);
    const contentWidth = React.useRef(0);
    const recomputeOverflow = React.useCallback(() => {
        canScroll.value = contentWidth.current > viewportWidth.current + 1;
    }, [canScroll]);

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

    const handleScroll = React.useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollX.value = e.nativeEvent.contentOffset.x;
        onScroll?.(e);
    }, [scrollX, onScroll]);

    // Gesture.Native() is the ScrollView's own scroll recognizer (kept for
    // native momentum). The arbiter Pan only decides who owns the drag; it never
    // moves content itself. Composing them with Gesture.Simultaneous lets the
    // ScrollView keep scrolling while the arbiter blocks the drawer.
    const gesture = React.useMemo(() => {
        const native = Gesture.Native();
        const arbiter = Gesture.Pan()
            .manualActivation(true)
            .onTouchesDown((e) => {
                'worklet';
                const t = e.allTouches[0];
                if (!t) return;
                startX.value = t.x;
                startY.value = t.y;
                decided.value = false;
            })
            .onTouchesMove((e, state) => {
                'worklet';
                if (decided.value) return;
                const t = e.allTouches[0];
                if (!t) return;
                const dx = t.x - startX.value;
                const dy = t.y - startY.value;
                const adx = Math.abs(dx);
                const ady = Math.abs(dy);
                if (adx < DECIDE_OFFSET && ady < DECIDE_OFFSET) return;
                decided.value = true;
                // Vertical → list scrolls (the drawer self-fails on failOffsetY).
                if (ady > adx) { state.fail(); return; }
                // Nothing to scroll → keep the open-anywhere drawer.
                if (!canScroll.value) { state.fail(); return; }
                // Right-going swipe with the table already at its left edge is the
                // sole case we hand to the drawer; everything else scrolls the table.
                if (dx > 0 && scrollX.value <= EDGE_EPS) { state.fail(); return; }
                state.activate();
            });
        if (drawerPan) {
            arbiter.blocksExternalGesture(drawerPan);
        }
        return Gesture.Simultaneous(native, arbiter);
    }, [drawerPan, startX, startY, decided, canScroll, scrollX]);

    return (
        <GestureDetector gesture={gesture}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={showsHorizontalScrollIndicator}
                nestedScrollEnabled={nestedScrollEnabled}
                onLayout={handleLayout}
                onContentSizeChange={handleContentSizeChange}
                onScroll={handleScroll}
                scrollEventThrottle={scrollEventThrottle ?? 16}
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
