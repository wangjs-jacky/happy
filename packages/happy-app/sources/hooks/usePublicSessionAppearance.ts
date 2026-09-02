import * as React from 'react';
import { UnistylesRuntime } from 'react-native-unistyles';
import { appThemes, resolveThemeName, type ThemePackId } from '@/themePacks';

export type PublicSessionAppearanceMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'paws.public-share.appearance-mode';
const DARK_MODE_QUERY = '(prefers-color-scheme: dark)';

function browserWindow(): Window | null {
    return typeof window === 'undefined' ? null : window;
}

function readStoredMode(): PublicSessionAppearanceMode {
    try {
        const value = browserWindow()?.localStorage.getItem(STORAGE_KEY);
        return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
    } catch {
        return 'system';
    }
}

function writeStoredMode(mode: PublicSessionAppearanceMode): void {
    try {
        browserWindow()?.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
    }
}

export function usePublicSessionAppearance(themePack: ThemePackId): {
    mode: PublicSessionAppearanceMode;
    setMode: React.Dispatch<React.SetStateAction<PublicSessionAppearanceMode>>;
} {
    const [mode, setMode] = React.useState<PublicSessionAppearanceMode>('system');
    const [systemIsDark, setSystemIsDark] = React.useState(false);
    const [storageReady, setStorageReady] = React.useState(false);

    React.useEffect(() => {
        const previousThemeName = UnistylesRuntime.themeName;
        const previousBackground = UnistylesRuntime.getTheme().colors.groupped.background;
        return () => {
            if (previousThemeName) UnistylesRuntime.setTheme(previousThemeName);
            UnistylesRuntime.setRootViewBackgroundColor(previousBackground);
        };
    }, []);

    React.useEffect(() => {
        setMode(readStoredMode());
        setStorageReady(true);
    }, []);

    React.useEffect(() => {
        if (storageReady) writeStoredMode(mode);
    }, [mode, storageReady]);

    React.useEffect(() => {
        if (mode !== 'system') return;
        const mediaQuery = browserWindow()?.matchMedia?.(DARK_MODE_QUERY);
        if (!mediaQuery) {
            setSystemIsDark(false);
            return;
        }
        setSystemIsDark(mediaQuery.matches);
        const handleChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [mode]);

    const isDark = mode === 'dark' || (mode === 'system' && systemIsDark);
    React.useEffect(() => {
        const themeName = resolveThemeName(themePack, isDark);
        UnistylesRuntime.setTheme(themeName);
        UnistylesRuntime.setRootViewBackgroundColor(appThemes[themeName].colors.groupped.background);
    }, [isDark, themePack]);

    return { mode, setMode };
}
