import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Pressable } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { UserProfile, getDisplayName } from '@/sync/friendTypes';
import { Avatar } from '@/components/Avatar';
import { t } from '@/text';
import { useRouter } from 'expo-router';

interface UserSearchResultProps {
    user: UserProfile;
    onAddFriend: () => void;
    isProcessing?: boolean;
}

export function UserSearchResult({ 
    user, 
    onAddFriend, 
    isProcessing = false 
}: UserSearchResultProps) {
    const router = useRouter();
    const displayName = getDisplayName(user);
    const avatarUrl = user.avatar?.url || user.avatar?.path;

    const getButtonLabel = () => {
        if (isProcessing) {
            return t('friends.addFriend');
        }

        switch (user.status) {
            case 'friend':
                return t('friends.alreadyFriends');
            case 'pending':
                return t('friends.requestPending');
            case 'requested':
                return t('friends.requestSent');
            default:
                return t('friends.addFriend');
        }
    };
    
    // Determine button state based on relationship status
    const getButtonContent = () => {
        if (isProcessing) {
            return <ActivityIndicator size="small" color="white" />;
        }
        
        switch (user.status) {
            case 'friend':
                return <Text style={styles.buttonTextDisabled}>{t('friends.alreadyFriends')}</Text>;
            case 'pending':
                return <Text style={styles.buttonTextDisabled}>{t('friends.requestPending')}</Text>;
            case 'requested':
                return <Text style={styles.buttonTextDisabled}>{t('friends.requestSent')}</Text>;
            default:
                return <Text style={styles.buttonText}>{t('friends.addFriend')}</Text>;
        }
    };
    
    const isDisabled = isProcessing || user.status === 'friend' || user.status === 'pending' || user.status === 'requested';

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <Pressable
                    accessibilityLabel={`${displayName}, @${user.username}`}
                    accessibilityRole="button"
                    style={styles.profileButton}
                    onPress={() => router.push(`/user/${user.id}`)}
                >
                    <Avatar
                        id={user.id}
                        size={48}
                        imageUrl={avatarUrl}
                        thumbhash={user.avatar?.thumbhash}
                    />

                    <View style={styles.info}>
                        <Text style={styles.name}>{displayName}</Text>
                        <Text style={styles.username}>@{user.username}</Text>
                    </View>
                </Pressable>

                <TouchableOpacity
                    accessibilityLabel={getButtonLabel()}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isDisabled }}
                    style={[
                        styles.button, 
                        isDisabled && styles.buttonDisabled
                    ]}
                    onPress={onAddFriend}
                    disabled={isDisabled}
                >
                    {getButtonContent()}
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        marginHorizontal: 16,
        marginVertical: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    profileButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    info: {
        flex: 1,
        marginLeft: 16,
    },
    name: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.text,
        marginBottom: 2,
    },
    username: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    button: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        minWidth: 100,
        alignItems: 'center',
    },
    buttonDisabled: {
        backgroundColor: theme.colors.divider,
    },
    buttonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 14,
        fontWeight: '600',
    },
    buttonTextDisabled: {
        color: theme.colors.textSecondary,
        fontSize: 14,
        fontWeight: '500',
    },
}));