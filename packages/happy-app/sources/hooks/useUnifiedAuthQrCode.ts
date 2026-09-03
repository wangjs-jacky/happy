import * as React from 'react';
import { Platform } from 'react-native';
import { CameraView } from 'expo-camera';
import { getAuthQrCodeKind } from '@/auth/authQrCodeKind';
import { useCheckScannerPermissions } from '@/hooks/useCheckCameraPermissions';
import { useConnectAccount } from '@/hooks/useConnectAccount';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { Modal } from '@/modal';
import { t } from '@/text';

interface UnifiedAuthQrCodeContextValue {
    connectAuthQrCode: () => Promise<void>;
    connectWithUrl: (url: string) => Promise<boolean>;
    isLoading: boolean;
}

const UnifiedAuthQrCodeContext = React.createContext<UnifiedAuthQrCodeContextValue | null>(null);

function showScannerUnavailableAlert() {
    Modal.alert(t('common.error'), t('modals.cameraPermissionsRequiredToScanQr'), [
        { text: t('common.ok') },
    ]);
}

function isScannerCancellation(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const { code, message } = error as { code?: unknown; message?: unknown };
    return (typeof code === 'string' && code.includes('BARCODE_SCANNING_CANCELLED'))
        || (typeof message === 'string' && message.includes('Barcode scanning was cancelled'));
}

export function UnifiedAuthQrCodeProvider({ children }: { children: React.ReactNode }) {
    const checkScannerPermissions = useCheckScannerPermissions();
    const account = useConnectAccount();
    const terminal = useConnectTerminal();
    const isMountedRef = React.useRef(true);
    const isAuthenticatingRef = React.useRef(false);
    const isStartingScannerRef = React.useRef(false);
    const scannerSessionActiveRef = React.useRef(false);
    const [isStartingScanner, setIsStartingScanner] = React.useState(false);

    const processAuthUrl = React.useCallback(async (url: string) => {
        const kind = getAuthQrCodeKind(url);
        if (!kind) {
            Modal.alert(t('common.error'), t('modals.invalidAuthUrl'), [
                { text: t('common.ok') },
            ]);
            return false;
        }

        const confirmed = await Modal.confirm(
            kind === 'account' ? t('navigation.linkNewDevice') : t('navigation.connectTerminal'),
            kind === 'account'
                ? t('settingsAccount.linkNewDeviceSubtitle')
                : t('terminal.terminalRequestDescription'),
            {
                cancelText: t('common.cancel'),
                confirmText: t('common.continue'),
            },
        );
        if (!confirmed || !isMountedRef.current) {
            return false;
        }

        return kind === 'account'
            ? account.processAuthUrl(url)
            : terminal.processAuthUrl(url);
    }, [account.processAuthUrl, terminal.processAuthUrl]);

    const runAuthentication = React.useCallback(async (operation: () => Promise<boolean>) => {
        if (isAuthenticatingRef.current) {
            return false;
        }

        isAuthenticatingRef.current = true;
        try {
            return await operation();
        } finally {
            isAuthenticatingRef.current = false;
        }
    }, []);

    const connectWithUrl = React.useCallback(async (url: string) => {
        return runAuthentication(() => processAuthUrl(url));
    }, [processAuthUrl, runAuthentication]);

    const dismissOwnedScanner = React.useCallback(async (): Promise<boolean> => {
        if (!scannerSessionActiveRef.current) {
            return true;
        }

        scannerSessionActiveRef.current = false;
        if (Platform.OS !== 'ios') {
            return true;
        }

        try {
            await CameraView.dismissScanner();
            return true;
        } catch (error) {
            scannerSessionActiveRef.current = true;
            console.warn('Failed to dismiss authentication scanner', error);
            return false;
        }
    }, []);

    const connectAuthQrCode = React.useCallback(async () => {
        if (isStartingScannerRef.current) {
            return;
        }

        isStartingScannerRef.current = true;
        setIsStartingScanner(true);
        try {
            if (!CameraView.isModernBarcodeScannerAvailable || !await checkScannerPermissions()) {
                if (isMountedRef.current) {
                    showScannerUnavailableAlert();
                }
                return;
            }

            if (!isMountedRef.current) {
                return;
            }

            if (scannerSessionActiveRef.current && !await dismissOwnedScanner()) {
                return;
            }

            scannerSessionActiveRef.current = true;
            await CameraView.launchScanner({ barcodeTypes: ['qr'] });
            if (Platform.OS !== 'ios') {
                scannerSessionActiveRef.current = false;
            }
        } catch (error) {
            scannerSessionActiveRef.current = false;
            if (isMountedRef.current && !isScannerCancellation(error)) {
                console.warn('Failed to launch authentication scanner', error);
                showScannerUnavailableAlert();
            }
        } finally {
            isStartingScannerRef.current = false;
            if (isMountedRef.current) {
                setIsStartingScanner(false);
            }
        }
    }, [checkScannerPermissions, dismissOwnedScanner]);

    React.useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // The provider is mounted once for the authenticated app, so every entry point
    // shares one scanner subscription and one authentication single-flight guard.
    React.useEffect(() => {
        if (!CameraView.isModernBarcodeScannerAvailable) {
            return;
        }

        const subscription = CameraView.onModernBarcodeScanned(async (event) => {
            if (!scannerSessionActiveRef.current) {
                return;
            }

            const scannerDismissed = await dismissOwnedScanner();
            await runAuthentication(() => processAuthUrl(event.data));

            // A failed iOS dismissal restores ownership so cleanup can retry. Retry
            // here as well so the native scanner does not cover the result dialog.
            if (!scannerDismissed) {
                await dismissOwnedScanner();
            }
        });

        return () => {
            subscription.remove();
            const shouldDismissScanner = scannerSessionActiveRef.current;
            scannerSessionActiveRef.current = false;
            if (Platform.OS === 'ios' && shouldDismissScanner) {
                CameraView.dismissScanner().catch((error: unknown) => {
                    console.warn('Failed to dismiss scanner during cleanup', error);
                });
            }
        };
    }, [dismissOwnedScanner, processAuthUrl, runAuthentication]);

    const value = React.useMemo<UnifiedAuthQrCodeContextValue>(() => ({
        connectAuthQrCode,
        connectWithUrl,
        isLoading: isStartingScanner || account.isLoading || terminal.isLoading,
    }), [account.isLoading, connectAuthQrCode, connectWithUrl, isStartingScanner, terminal.isLoading]);

    return React.createElement(UnifiedAuthQrCodeContext.Provider, { value }, children);
}

export function useUnifiedAuthQrCode(): UnifiedAuthQrCodeContextValue {
    const value = React.useContext(UnifiedAuthQrCodeContext);
    if (!value) {
        throw new Error('useUnifiedAuthQrCode must be used within UnifiedAuthQrCodeProvider');
    }
    return value;
}
