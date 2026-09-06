import { useRouter } from 'expo-router';
import * as React from 'react';
import { Platform } from 'react-native';
import { useIsTablet } from '@/utils/responsive';

type DesktopSettingsModalController = {
    isDesktop: boolean;
    openSettings: () => void;
    openActivity: () => void;
};

const DesktopSettingsModalContext = React.createContext<DesktopSettingsModalController | null>(null);

export function useDesktopSettingsModal(): DesktopSettingsModalController {
    const controller = React.useContext(DesktopSettingsModalContext);
    if (!controller) throw new Error('useDesktopSettingsModal must be used within DesktopSettingsModalProvider');
    return controller;
}

/** Entry points only; the app navigator owns modal history and screen rendering. */
export function DesktopSettingsModalProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const isTablet = useIsTablet();
    const isDesktop = Platform.OS === 'web' && isTablet;
    const open = React.useCallback((pathname: '/settings' | '/inbox') => {
        router.push(isDesktop ? { pathname, params: { desktopModal: '1' } } : pathname);
    }, [isDesktop, router]);
    const controller = React.useMemo(() => ({
        isDesktop,
        openSettings: () => open('/settings'),
        openActivity: () => open('/inbox'),
    }), [isDesktop, open]);
    return <DesktopSettingsModalContext.Provider value={controller}>{children}</DesktopSettingsModalContext.Provider>;
}
