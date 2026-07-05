import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { OtaPreviewCard } from '@/components/OtaPreviewCard';
import { Typography } from '@/constants/Typography';
import { type SessionOtaPreview } from '@/utils/sessionOtaPreviews';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export const SessionOtaSidebar = React.memo(function SessionOtaSidebar(props: { previews: SessionOtaPreview[] }) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const latest = props.previews[0] ?? null;

    return (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.heroCard}>
                <Text style={styles.eyebrow}>Standard Workflow</Text>
                <Text style={styles.heroTitle}>Latest OTA</Text>
                <Text style={styles.heroSubtitle}>
                    {latest
                        ? 'Happy extracted this OTA deliverable from the session and keeps the latest publish details here.'
                        : 'No OTA preview was detected in this session yet.'}
                </Text>
            </View>

            {props.previews.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
                    <Ionicons name="rocket-outline" size={20} color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>
                        Publish a preview OTA from the agent workflow and the result will appear here.
                    </Text>
                </View>
            ) : (
                props.previews.map((preview, index) => {
                    return (
                        <OtaPreviewCard
                            key={preview.id}
                            preview={preview}
                            latest={index === 0}
                            variant="sidebar"
                        />
                    );
                })
            )}
        </ScrollView>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 12,
        paddingTop: 14,
        paddingBottom: 16,
        gap: 10,
    },
    heroCard: {
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 14,
        backgroundColor: theme.colors.groupped.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
    },
    eyebrow: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 0.7,
        textTransform: 'uppercase',
    },
    heroTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 18,
        lineHeight: 22,
        marginTop: 8,
    },
    heroSubtitle: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 6,
    },
    emptyCard: {
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        paddingVertical: 14,
        gap: 8,
    },
    emptyText: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
    },
}));
