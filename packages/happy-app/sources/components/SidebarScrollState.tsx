import * as React from 'react';
import type { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

// Owned by the sidebar, not the account or module: closing the drawer keeps
// positions, while unmounting the authenticated workspace discards them.
const SidebarScrollContext = React.createContext<Map<string, number> | null>(null);

export function SidebarScrollProvider({ children }: React.PropsWithChildren) {
    const positions = React.useRef(new Map<string, number>()).current;
    return <SidebarScrollContext.Provider value={positions}>{children}</SidebarScrollContext.Provider>;
}

export function useSidebarScrollState<T>(key: string) {
    const positions = React.useContext(SidebarScrollContext);
    const ref = React.useRef<FlatList<T>>(null);
    const state = React.useMemo(() => ({
        offset: positions?.get(key) ?? 0,
        restoring: (positions?.get(key) ?? 0) > 0,
        height: 0,
        contentHeight: 0,
        active: true,
    }), [key, positions]);

    React.useLayoutEffect(() => {
        state.active = true;
        return () => { state.active = false; };
    }, [state]);

    const cancelRestoration = React.useCallback(() => { state.restoring = false; }, [state]);
    const restore = React.useCallback(() => {
        if (!state.active || !state.restoring || !state.height || !state.contentHeight) return;
        ref.current?.scrollToOffset({ offset: state.offset, animated: false });
    }, [state]);

    return {
        ref,
        onLayout: React.useCallback((event: LayoutChangeEvent) => {
            state.height = event.nativeEvent.layout.height;
            restore();
        }, [restore, state]),
        onContentSizeChange: React.useCallback((_width: number, height: number) => {
            state.contentHeight = height;
            restore();
        }, [restore, state]),
        onScrollBeginDrag: cancelRestoration,
        // React Native Web forwards these to the scroll element. A wheel or
        // scrollbar drag must take over even while virtual cells are measuring.
        onWheel: cancelRestoration,
        onPointerDown: cancelRestoration,
        onKeyDown: React.useCallback((event: { key?: string }) => {
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key ?? '')) {
                cancelRestoration();
            }
        }, [cancelRestoration]),
        onScroll: React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (!state.active) return false;
            const offset = event.nativeEvent.contentOffset.y;
            if (state.restoring) {
                if (!state.height || !state.contentHeight) return false;
                // The first virtualized batch can be shorter than the saved
                // offset. Do not mistake its temporary scroll clamp for success.
                const target = state.offset;
                if (Math.abs(offset - target) > 1) return false;
                state.restoring = false;
                state.offset = offset;
                positions?.set(key, offset);
                return false;
            }
            state.offset = offset;
            positions?.set(key, offset);
            return true;
        }, [key, positions, state]),
        scrollEventThrottle: 32,
    };
}
