import * as React from 'react';
import { useAuth } from '@/auth/AuthContext';
import { decodeBase64 } from '@/encryption/base64';
import { encryptBox } from '@/encryption/libsodium';
import { AccountLinkApprovalError, authAccountApprove } from '@/auth/authAccountApprove';
import { Modal } from '@/modal';
import { t } from '@/text';

interface UseConnectAccountOptions {
    onSuccess?: () => void;
    onError?: (error: any) => void;
}

export function useConnectAccount(options?: UseConnectAccountOptions) {
    const auth = useAuth();
    const [isLoading, setIsLoading] = React.useState(false);

    const processAuthUrl = React.useCallback(async (url: string) => {
        if (!url.startsWith('paws:///account?')) {
            Modal.alert(t('common.error'), t('modals.invalidAuthUrl'), [{ text: t('common.ok') }]);
            return false;
        }
        
        setIsLoading(true);
        try {
            const tail = url.slice('paws:///account?'.length);
            const publicKey = decodeBase64(tail, 'base64url');
            const response = encryptBox(decodeBase64(auth.credentials!.secret, 'base64url'), publicKey);
            await authAccountApprove(auth.credentials!.token, publicKey, response);
            
            Modal.alert(t('common.success'), t('modals.deviceLinkedSuccessfully'), [
                { 
                    text: t('common.ok'), 
                    onPress: () => options?.onSuccess?.()
                }
            ]);
            return true;
        } catch (e) {
            if (e instanceof AccountLinkApprovalError) {
                console.error('Account link approval failed', {
                    code: e.code,
                    publicKeyId: e.publicKeyId,
                    server: e.server,
                    status: e.status,
                });
                const message = e.code === 'request-not-found'
                    ? t('modals.accountLinkRequestNotFound', { server: e.server })
                    : e.code === 'unauthorized'
                        ? t('modals.accountLinkUnauthorized', { server: e.server })
                        : e.code === 'network'
                            ? t('modals.accountLinkNetworkError', { server: e.server })
                            : t('modals.accountLinkServerError', { server: e.server, status: e.status ?? 0 });
                Modal.alert(t('common.error'), message, [{ text: t('common.ok') }]);
            } else {
                console.error('Account link failed before server approval', { code: 'client-error' });
                Modal.alert(t('common.error'), t('modals.failedToLinkDevice'), [{ text: t('common.ok') }]);
            }
            options?.onError?.(e);
            return false;
        } finally {
            setIsLoading(false);
        }
    }, [auth.credentials, options]);

    return {
        isLoading,
        processAuthUrl
    };
}
