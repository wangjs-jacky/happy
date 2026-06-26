// Closing the phone sidebar's `front` drawer only works when DrawerActions.closeDrawer()
// is dispatched on the *drawer's own* navigation object. In practice, calling
// useNavigation() from a component deep inside the drawer content — specifically a
// session row rendered by SessionsList's FlatList — did NOT resolve to that drawer
// navigator, so closeDrawer() was a silent no-op there (while the identical call from
// SidebarView's own buttons closed it fine). Rather than depend on context resolution
// through the list cells, SidebarView registers its known-working close function here
// and the session-navigation hook triggers it directly.
let closer: (() => void) | null = null;

/**
 * Registers the sidebar drawer's close function. SidebarView calls this on mount with a
 * closure bound to the drawer's navigation. Returns an unregister function for cleanup.
 */
export function registerSidebarDrawerCloser(fn: () => void): () => void {
    closer = fn;
    return () => {
        if (closer === fn) {
            closer = null;
        }
    };
}

/**
 * Closes the sidebar drawer if one is currently registered. No-op when there is no
 * drawer (e.g. before SidebarView mounts) or when the drawer is permanent (desktop).
 */
export function closeSidebarDrawer(): void {
    closer?.();
}

/** DEBUG: whether a closer is currently registered. Temporary, for on-device diagnosis. */
export function isSidebarDrawerCloserRegistered(): boolean {
    return closer !== null;
}
