import * as React from 'react';
import { useIsDesktopModalScene } from '@/components/DesktopModalScene';
import { View, Text, Platform, Pressable } from 'react-native';
import { InboxView } from "@/components/InboxView";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useIsTablet, useHeaderHeight } from '@/utils/responsive';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    header: {
        backgroundColor: theme.colors.header.background,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    headerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    backButton: {
        marginRight: 16,
    },
    headerTitle: {
        fontSize: 17,
        color: theme.colors.header.tint,
        ...Typography.default('semiBold'),
    },
}));

export default function InboxPage() {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const isTablet = useIsTablet();
    const inDesktopModal = useIsDesktopModalScene();
    const router = useRouter();
    const headerHeight = useHeaderHeight();

    // Phone pages own their header; the desktop dialog provides its own.
    if (!isTablet && !inDesktopModal) {
        // Phone mode: render with header
        return (
            <View style={styles.container}>
                <View style={[styles.header, { paddingTop: insets.top }]}>
                    <View style={[styles.headerContent, { height: headerHeight }]}>
                        <Pressable
                            accessibilityLabel={t('common.back')}
                            accessibilityRole="button"
                            onPress={() => router.back()}
                            style={styles.backButton}
                            hitSlop={15}
                        >
                            <Ionicons
                                name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                                size={24}
                                color={theme.colors.header.tint}
                            />
                        </Pressable>
                        <Text style={styles.headerTitle}>{t('tabs.inbox')}</Text>
                    </View>
                </View>
                <InboxView />
            </View>
        );
    }

    // Tablet and modal layouts render the activity content.
    return (
        <InboxView />
    );
}