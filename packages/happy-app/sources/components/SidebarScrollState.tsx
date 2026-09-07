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
    }), [key, positions]);

    const restore = React.useCallback(() => {
        if (!state.restoring || !state.height || !state.contentHeight) return;
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
        onScrollBeginDrag: React.useCallback(() => { state.restoring = false; }, [state]),
        onScroll: React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const offset = event.nativeEvent.contentOffset.y;
            if (state.restoring) {
                if (!state.height || !state.contentHeight) return false;
                const target = Math.min(state.offset, Math.max(0, state.contentHeight - state.height));
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
