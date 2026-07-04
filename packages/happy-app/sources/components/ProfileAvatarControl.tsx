import * as React from 'react';
import { ActivityIndicator, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native-unistyles';
import { Avatar } from './Avatar';
import { useProfileAvatarUpload } from '@/hooks/useProfileAvatarUpload';
import { getAvatarUrl, type Profile } from '@/sync/profile';
import { imageViewer } from '@/sync/imageViewer';
import { t } from '@/text';

type ProfileAvatarControlProps = {
    profile: Profile;
    size: number;
    style?: StyleProp<ViewStyle>;
};

const styles = StyleSheet.create((theme) => ({
    root: {
        position: 'relative',
    },
    avatarButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    cameraButton: {
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.surface,
    },
}));

export function ProfileAvatarControl({ profile, size, style }: ProfileAvatarControlProps) {
    const [uploadingAvatar, handleUploadAvatar] = useProfileAvatarUpload();
    const avatarUrl = getAvatarUrl(profile);

    const openAvatar = React.useCallback(() => {
        if (avatarUrl) {
            imageViewer.open({
                uri: avatarUrl,
                width: profile.avatar?.width,
                height: profile.avatar?.height,
                actionLabel: t('imageUpload.changeAvatar'),
                onAction: () => {
                    imageViewer.close();
                    setTimeout(handleUploadAvatar, 0);
                },
            });
        } else {
            handleUploadAvatar();
        }
    }, [avatarUrl, handleUploadAvatar, profile.avatar?.height, profile.avatar?.width]);

    const cameraSize = Math.max(17, Math.round(size * 0.34));
    const iconSize = Math.max(11, Math.round(cameraSize * 0.58));
    const borderWidth = size >= 64 ? 2 : 1.5;
    const offset = size >= 64 ? -2 : -3;

    return (
        <View style={[styles.root, { width: size, height: size }, style]}>
            <Pressable
                onPress={openAvatar}
                style={[styles.avatarButton, { width: size, height: size }]}
                accessibilityRole="button"
                accessibilityLabel={avatarUrl ? t('imageUpload.viewAvatar') : t('imageUpload.changeAvatar')}
            >
                <Avatar
                    id={profile.id}
                    size={size}
                    imageUrl={avatarUrl}
                    thumbhash={profile.avatar?.thumbhash}
                />
            </Pressable>
            <Pressable
                onPress={handleUploadAvatar}
                disabled={uploadingAvatar}
                hitSlop={8}
                style={[
                    styles.cameraButton,
                    {
                        right: offset,
                        bottom: offset,
                        width: cameraSize,
                        height: cameraSize,
                        borderRadius: cameraSize / 2,
                        borderWidth,
                    },
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('imageUpload.changeAvatar')}
            >
                {uploadingAvatar ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                    <Ionicons name="camera-outline" size={iconSize} color="#FFFFFF" />
                )}
            </Pressable>
        </View>
    );
}
