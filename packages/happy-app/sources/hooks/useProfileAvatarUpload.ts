import * as React from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/auth/AuthContext';
import { Modal } from '@/modal';
import { uploadProfileAvatar } from '@/sync/apiAccount';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { useHappyAction } from './useHappyAction';

export function useProfileAvatarUpload() {
    const auth = useAuth();

    const uploadAvatar = React.useCallback(async () => {
        if (!auth.credentials) {
            return;
        }

        if (Platform.OS !== 'web') {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Modal.alert(t('imageUpload.permissionTitle'), t('imageUpload.avatarPermissionMessage'));
                return;
            }
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.9,
            exif: false,
        });

        if (result.canceled || !result.assets.length) {
            return;
        }

        try {
            await uploadProfileAvatar(auth.credentials, {
                uri: result.assets[0].uri,
                mimeType: result.assets[0].mimeType,
            });
            await sync.refreshProfile();
        } catch (error) {
            Modal.alert(
                t('imageUpload.avatarUploadFailedTitle'),
                error instanceof Error ? error.message : t('imageUpload.avatarUploadFailedMessage'),
            );
        }
    }, [auth.credentials]);

    return useHappyAction(uploadAvatar);
}
