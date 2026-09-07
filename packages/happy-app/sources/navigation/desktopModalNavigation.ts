type DesktopModalNavigation = { back: () => void; close: () => void };
let active: DesktopModalNavigation | null = null;

/** Global desktop shortcuts must give the foreground dialog priority over session overlays. */
export function registerDesktopModalNavigation(navigation: DesktopModalNavigation) {
    active = navigation;
    return () => { if (active === navigation) active = null; };
}

export function navigateDesktopModalBack(close: boolean): boolean {
    if (!active) return false;
    if (close) active.close();
    else active.back();
    return true;
}
