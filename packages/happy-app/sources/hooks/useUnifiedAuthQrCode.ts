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
    const isAuthenticatingRef = React.useRef(false);
    const isScannerOpenRef = React.useRef(false);
    const [isStartingScanner, setIsStartingScanner] = React.useState(false);

    const processAuthUrl = React.useCallback(async (url: string) => {
        const kind = getAuthQrCodeKind(url);
        if (kind === 'account') {
            return account.processAuthUrl(url);
        }
        if (kind === 'terminal') {
            return terminal.processAuthUrl(url);
        }

        Modal.alert(t('common.error'), t('modals.invalidAuthUrl'), [
            { text: t('common.ok') },
        ]);
        return false;
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

    const connectAuthQrCode = React.useCallback(async () => {
        if (isScannerOpenRef.current) {
            return;
        }

        isScannerOpenRef.current = true;
        setIsStartingScanner(true);
        try {
            if (!CameraView.isModernBarcodeScannerAvailable || !await checkScannerPermissions()) {
                isScannerOpenRef.current = false;
                showScannerUnavailableAlert();
                return;
            }

            await CameraView.launchScanner({ barcodeTypes: ['qr'] });
            if (Platform.OS !== 'ios') {
                isScannerOpenRef.current = false;
            }
        } catch (error) {
            isScannerOpenRef.current = false;
            if (!isScannerCancellation(error)) {
                console.warn('Failed to launch authentication scanner', error);
                showScannerUnavailableAlert();
            }
        } finally {
            setIsStartingScanner(false);
        }
    }, [checkScannerPermissions]);

    // The provider is mounted once for the authenticated app, so every entry point
    // shares one scanner subscription and one authentication single-flight guard.
    React.useEffect(() => {
        if (!CameraView.isModernBarcodeScannerAvailable) {
            return;
        }

        const subscription = CameraView.onModernBarcodeScanned(async (event) => {
            isScannerOpenRef.current = false;
            await runAuthentication(async () => {
                if (Platform.OS === 'ios') {
                    try {
                        await CameraView.dismissScanner();
                    } catch (error) {
                        console.warn('Failed to dismiss scanner before authentication', error);
                    }
                }
                return processAuthUrl(event.data);
            });
        });

        return () => {
            subscription.remove();
            isScannerOpenRef.current = false;
            if (Platform.OS === 'ios') {
                CameraView.dismissScanner().catch((error: unknown) => {
                    console.warn('Failed to dismiss scanner during cleanup', error);
                });
            }
        };
    }, [processAuthUrl, runAuthentication]);

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
