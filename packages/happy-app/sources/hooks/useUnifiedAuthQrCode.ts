import * as React from 'react';
import { Platform } from 'react-native';
import { CameraView } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { getAuthQrCodeKind } from '@/auth/authQrCodeKind';
import { useCheckScannerPermissions } from '@/hooks/useCheckCameraPermissions';
import { useConnectAccount } from '@/hooks/useConnectAccount';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { Modal } from '@/modal';
import { t } from '@/text';

export function useUnifiedAuthQrCode() {
    const checkScannerPermissions = useCheckScannerPermissions();
    const isFocused = useIsFocused();
    const account = useConnectAccount();
    const terminal = useConnectTerminal();
    const isProcessingRef = React.useRef(false);

    const connectWithUrl = React.useCallback(async (url: string) => {
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

    const connectAuthQrCode = React.useCallback(async () => {
        if (await checkScannerPermissions()) {
            CameraView.launchScanner({ barcodeTypes: ['qr'] });
            return;
        }

        Modal.alert(t('common.error'), t('modals.cameraPermissionsRequiredToScanQr'), [
            { text: t('common.ok') },
        ]);
    }, [checkScannerPermissions]);

    // Keep scanner ownership in one focused screen, then dispatch each QR payload
    // to the account or terminal authenticator after suppressing duplicate events.
    React.useEffect(() => {
        if (!isFocused || !CameraView.isModernBarcodeScannerAvailable) {
            return;
        }

        const subscription = CameraView.onModernBarcodeScanned(async (event) => {
            if (isProcessingRef.current) {
                return;
            }

            isProcessingRef.current = true;
            try {
                if (Platform.OS === 'ios') {
                    try {
                        await CameraView.dismissScanner();
                    } catch (error) {
                        console.warn('Failed to dismiss scanner before authentication', error);
                    }
                }
                await connectWithUrl(event.data);
            } finally {
                isProcessingRef.current = false;
            }
        });

        return () => {
            subscription.remove();
            isProcessingRef.current = false;
            if (Platform.OS === 'ios') {
                CameraView.dismissScanner().catch((error: unknown) => {
                    console.warn('Failed to dismiss scanner during cleanup', error);
                });
            }
        };
    }, [connectWithUrl, isFocused]);

    return {
        connectAuthQrCode,
        connectWithUrl,
        isLoading: account.isLoading || terminal.isLoading,
    };
}
