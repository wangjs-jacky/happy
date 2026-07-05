import * as React from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { openExternalUrl } from '@/utils/openExternalUrl';
import {
    type SessionOtaPreview,
    formatOtaPreviewIdentity,
    formatOtaPreviewLabel,
    getOtaPreviewPrimaryLink,
} from '@/utils/sessionOtaPreviews';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

type CardAction = {
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    url: string;
};

function Badge(props: { label: string; tone?: 'neutral' | 'accent' }) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const backgroundColor = props.tone === 'accent'
        ? (theme.colors.button.primary.background ? `${theme.colors.button.primary.background}18` : '#0A84FF18')
        : theme.colors.surfaceHighest;
    const color = props.tone === 'accent'
        ? (theme.colors.button.primary.background ?? theme.colors.text)
        : theme.colors.textSecondary;

    return (
        <View style={[styles.badge, { backgroundColor }]}>
            <Text style={[styles.badgeText, { color }]}>{props.label}</Text>
        </View>
    );
}

function ActionChip(props: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    url: string;
    tone?: 'secondary' | 'primary';
    prominent?: boolean;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const prominent = props.prominent ?? false;
    const tone = props.tone ?? 'secondary';
    const backgroundColor = tone === 'primary'
        ? (theme.colors.button.primary.background ?? theme.colors.text)
        : theme.colors.surfaceHighest;
    const borderColor = tone === 'primary'
        ? (theme.colors.button.primary.background ?? theme.colors.text)
        : theme.colors.divider;
    const iconColor = tone === 'primary'
        ? theme.colors.button.primary.tint
        : theme.colors.textSecondary;
    const textColor = tone === 'primary'
        ? theme.colors.button.primary.tint
        : theme.colors.text;

    return (
        <Pressable
            onPress={() => void openExternalUrl(props.url)}
            style={({ pressed }) => [
                prominent ? styles.actionChipPrimary : styles.actionChip,
                {
                    backgroundColor,
                    borderColor,
                    opacity: pressed ? 0.84 : 1,
                },
            ]}
        >
            <Ionicons name={props.icon} size={prominent ? 16 : 14} color={iconColor} />
            <Text style={[styles.actionChipText, { color: textColor }, prominent && styles.actionChipPrimaryText]}>
                {props.label}
            </Text>
        </Pressable>
    );
}

export const OtaPreviewCard = React.memo(function OtaPreviewCard(props: {
    preview: SessionOtaPreview;
    style?: ViewStyle;
    latest?: boolean;
    variant?: 'message' | 'sidebar';
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const primaryUrl = getOtaPreviewPrimaryLink(props.preview);
    const label = formatOtaPreviewLabel(props.preview);
    const identity = formatOtaPreviewIdentity(props.preview);
    const variant = props.variant ?? 'message';
    const isMessage = variant === 'message';
    const summaryLines = isMessage ? 4 : 3;
    const primaryLabel = props.preview.sourceUrl ? 'Open PR' : props.preview.siteUrl ? 'Versions' : 'Open manifest';
    const primaryIcon: keyof typeof Ionicons.glyphMap = props.preview.sourceUrl
        ? 'logo-github'
        : props.preview.siteUrl
            ? 'albums-outline'
            : 'document-text-outline';
    const secondaryActions: CardAction[] = [];
    if (props.preview.siteUrl && props.preview.siteUrl !== primaryUrl) {
        secondaryActions.push({ key: 'versions', label: 'Versions', icon: 'albums-outline', url: props.preview.siteUrl });
    }
    if (props.preview.sourceUrl && props.preview.sourceUrl !== primaryUrl) {
        secondaryActions.push({ key: 'pr', label: 'PR', icon: 'logo-github', url: props.preview.sourceUrl });
    }
    if (props.preview.manifestUrl && props.preview.manifestUrl !== primaryUrl) {
        secondaryActions.push({ key: 'manifest', label: 'Manifest', icon: 'document-text-outline', url: props.preview.manifestUrl });
    }
    const details = [
        { key: 'identity', label: 'Identity', value: identity || props.preview.updateId || 'n/a', lines: 2 },
        { key: 'update', label: 'Update ID', value: props.preview.updateId ?? 'n/a', lines: 2 },
        { key: 'manifest', label: 'Manifest', value: props.preview.manifestUrl ?? 'n/a', lines: isMessage ? 2 : 3 },
    ];

    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.divider,
                },
                variant === 'message' ? styles.cardMessage : styles.cardSidebar,
                props.style,
            ]}
        >
            <View style={styles.topRow}>
                <View style={styles.titleWrap}>
                    <View style={styles.eyebrowRow}>
                        <Text style={styles.eyebrow}>{props.preview.channel === 'preview' ? 'Preview OTA' : 'OTA Release'}</Text>
                        {props.latest ? <Badge label="latest" tone="accent" /> : null}
                    </View>
                    <Text style={styles.title} numberOfLines={2}>
                        {props.preview.title}
                    </Text>
                    <Text style={styles.label}>{label}</Text>
                </View>
            </View>

            <View style={styles.badgeRow}>
                {props.preview.channel ? <Badge label={props.preview.channel} /> : null}
                {props.preview.platform ? <Badge label={props.preview.platform} /> : null}
                {props.preview.runtimeVersion ? <Badge label={`runtime ${props.preview.runtimeVersion}`} /> : null}
            </View>

            {props.preview.summary ? (
                <View style={styles.summaryCard}>
                    <Text style={styles.summary} numberOfLines={summaryLines}>
                        {props.preview.summary}
                    </Text>
                </View>
            ) : null}

            <View style={styles.metaCard}>
                {details.map((detail, index) => (
                    <View
                        key={detail.key}
                        style={[styles.metaRow, index > 0 && styles.metaRowBorder]}
                    >
                        <Text style={styles.metaLabel}>{detail.label}</Text>
                        <Text style={styles.metaValue} numberOfLines={detail.lines}>
                            {detail.value}
                        </Text>
                    </View>
                ))}
            </View>

            <View style={styles.actionGroup}>
                {primaryUrl ? (
                    <ActionChip
                        label={primaryLabel}
                        icon={primaryIcon}
                        url={primaryUrl}
                        tone={isMessage ? 'primary' : 'secondary'}
                        prominent={isMessage}
                    />
                ) : null}

                {secondaryActions.length > 0 ? (
                    <View style={styles.actionRow}>
                        {secondaryActions.map((action) => (
                            <ActionChip key={action.key} label={action.label} icon={action.icon} url={action.url} />
                        ))}
                    </View>
                ) : null}
            </View>
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 16,
        paddingVertical: 16,
        gap: 12,
    },
    cardMessage: {
        marginVertical: 8,
        width: '100%',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: theme.colors.shadow.opacity * 0.5,
        shadowRadius: 10,
        elevation: 4,
    },
    cardSidebar: {
        width: '100%',
    },
    topRow: {
        gap: 10,
    },
    titleWrap: {
        gap: 6,
    },
    eyebrowRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    eyebrow: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 0.7,
        textTransform: 'uppercase',
    },
    title: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 18,
        lineHeight: 24,
        letterSpacing: -0.2,
    },
    label: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
    },
    badgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    badge: {
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 4,
    },
    badgeText: {
        ...Typography.default('semiBold'),
        fontSize: 10,
        lineHeight: 12,
    },
    summaryCard: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 11,
    },
    summary: {
        ...Typography.default(),
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 18,
    },
    metaCard: {
        backgroundColor: theme.colors.surfaceHigh,
        borderRadius: 14,
        overflow: 'hidden',
    },
    metaLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 11,
        lineHeight: 14,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        flexShrink: 0,
        width: 66,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 11,
    },
    metaRowBorder: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    metaValue: {
        ...Typography.mono(),
        color: theme.colors.text,
        fontSize: 12,
        lineHeight: 18,
        flex: 1,
    },
    actionGroup: {
        gap: 8,
    },
    actionRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    actionChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    actionChipPrimary: {
        minHeight: 46,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    actionChipText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        lineHeight: 14,
    },
    actionChipPrimaryText: {
        fontSize: 14,
        lineHeight: 18,
    },
}));
