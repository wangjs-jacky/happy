import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAttachmentImage } from '@/hooks/useAttachmentImage';
import { imageViewer } from '@/sync/imageViewer';
import { t } from '@/text';
import type {
    ArtifactCapabilityItem,
    CapabilityItem,
    CapabilityKey,
    FileCapabilityItem,
    ImageCapabilityItem,
} from './sessionCapabilityHubModel';

type Props = {
    count: number;
    items: CapabilityItem[];
    onBack: () => void;
    sessionId: string;
    title: string;
    type: CapabilityKey;
};

export const CapabilityHubDetailView = React.memo(function CapabilityHubDetailView(props: Props) {
    const { theme } = useUnistyles();

    return (
        <View style={styles.container}>
            <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
                <Pressable hitSlop={8} onPress={props.onBack} style={styles.backButton}>
                    <Ionicons color={theme.colors.text} name="chevron-back" size={18} />
                    <Text style={[styles.backText, { color: theme.colors.text }]}>{t('rightPanelCapabilityHub.back')}</Text>
                </Pressable>
                <View style={styles.headerCopy}>
                    <Text numberOfLines={1} style={[styles.headerTitle, { color: theme.colors.text }]}>
                        {props.title}
                    </Text>
                    <Text style={[styles.headerMeta, { color: theme.colors.textSecondary }]}>
                        {props.count}
                    </Text>
                </View>
            </View>

            {props.items.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                        {t(`rightPanelCapabilityHub.empty.${props.type}` as const)}
                    </Text>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {props.items.map((item) => (
                        <CapabilityItemRow
                            item={item}
                            key={item.id}
                            sessionId={props.sessionId}
                        />
                    ))}
                </ScrollView>
            )}
        </View>
    );
});

const CapabilityItemRow = React.memo(function CapabilityItemRow(props: {
    item: CapabilityItem;
    sessionId: string;
}) {
    if (props.item.kind === 'image') {
        return <ImageItemRow item={props.item} sessionId={props.sessionId} />;
    }
    if (props.item.kind === 'artifact') {
        return <ArtifactItemRow item={props.item} />;
    }
    if (props.item.kind === 'file') {
        return <FileItemRow item={props.item} sessionId={props.sessionId} />;
    }
    return <SkillItemRow title={props.item.title} />;
});

const SkillItemRow = React.memo(function SkillItemRow(props: { title: string }) {
    const { theme } = useUnistyles();

    return (
        <View style={[styles.rowCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
            <View style={[styles.rowIconWrap, { backgroundColor: theme.colors.surfaceHigh }]}>
                <Ionicons color={theme.colors.text} name="flash-outline" size={15} />
            </View>
            <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.colors.text }]}>
                    {props.title}
                </Text>
                <Text numberOfLines={1} style={[styles.rowMeta, { color: theme.colors.textSecondary }]}>
                    {t('rightPanelCapabilityHub.meta.available')}
                </Text>
            </View>
        </View>
    );
});

const ImageItemRow = React.memo(function ImageItemRow(props: {
    item: ImageCapabilityItem;
    sessionId: string;
}) {
    const { theme } = useUnistyles();
    const { uri } = useAttachmentImage(props.sessionId, props.item.ref);
    const subtitle = props.item.width && props.item.height
        ? `${props.item.width} × ${props.item.height}`
        : t('rightPanelCapabilityHub.meta.image');

    return (
        <Pressable
            disabled={!uri}
            onPress={uri ? () => imageViewer.open({ uri, width: props.item.width, height: props.item.height }) : undefined}
            style={({ pressed }) => [
                styles.rowCard,
                {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.divider,
                    opacity: uri ? 1 : 0.78,
                    transform: [{ scale: pressed ? 0.99 : 1 }],
                },
            ]}
        >
            <View style={[styles.rowIconWrap, { backgroundColor: theme.colors.surfaceHigh }]}>
                <Ionicons color={theme.colors.text} name="image-outline" size={15} />
            </View>
            <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.colors.text }]}>
                    {props.item.title}
                </Text>
                <Text numberOfLines={1} style={[styles.rowMeta, { color: theme.colors.textSecondary }]}>
                    {subtitle}
                </Text>
            </View>
            {!uri ? <ActivityIndicator color={theme.colors.textSecondary} size="small" /> : <Ionicons color={theme.colors.textSecondary} name="expand-outline" size={16} />}
        </Pressable>
    );
});

const ArtifactItemRow = React.memo(function ArtifactItemRow(props: {
    item: ArtifactCapabilityItem;
}) {
    const router = useRouter();
    const { theme } = useUnistyles();

    return (
        <Pressable
            onPress={() => router.push(`/artifacts/${props.item.artifactId}` as any)}
            style={({ pressed }) => [
                styles.rowCard,
                {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.divider,
                    transform: [{ scale: pressed ? 0.99 : 1 }],
                },
            ]}
        >
            <View style={[styles.rowIconWrap, { backgroundColor: theme.colors.surfaceHigh }]}>
                <Ionicons color={theme.colors.text} name="document-text-outline" size={15} />
            </View>
            <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.colors.text }]}>
                    {props.item.title}
                </Text>
                <Text numberOfLines={1} style={[styles.rowMeta, { color: theme.colors.textSecondary }]}>
                    {t('rightPanelCapabilityHub.meta.artifact')}
                </Text>
            </View>
            <Ionicons color={theme.colors.textSecondary} name="chevron-forward" size={16} />
        </Pressable>
    );
});

const FileItemRow = React.memo(function FileItemRow(props: {
    item: FileCapabilityItem;
    sessionId: string;
}) {
    const router = useRouter();
    const { theme } = useUnistyles();

    return (
        <Pressable
            onPress={() => router.push(`/session/${props.sessionId}/file?path=${btoa(props.item.path)}` as any)}
            style={({ pressed }) => [
                styles.rowCard,
                {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.divider,
                    transform: [{ scale: pressed ? 0.99 : 1 }],
                },
            ]}
        >
            <View style={[styles.rowIconWrap, { backgroundColor: theme.colors.surfaceHigh }]}>
                <Octicons color={theme.colors.text} name="file-code" size={14} />
            </View>
            <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.colors.text }]}>
                    {props.item.title}
                </Text>
                <Text numberOfLines={1} style={[styles.rowMeta, { color: theme.colors.textSecondary }]}>
                    {props.item.path}
                </Text>
            </View>
            <Ionicons color={theme.colors.textSecondary} name="chevron-forward" size={16} />
        </Pressable>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
        minHeight: 0,
    },
    header: {
        alignItems: 'center',
        borderBottomWidth: 1,
        flexDirection: 'row',
        gap: 8,
        paddingBottom: 10,
        paddingHorizontal: 14,
        paddingTop: 10,
    },
    backButton: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 2,
    },
    backText: {
        fontSize: 13,
        fontWeight: '600',
    },
    headerCopy: {
        alignItems: 'center',
        flex: 1,
        flexDirection: 'row',
        gap: 8,
        justifyContent: 'flex-end',
        minWidth: 0,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '700',
    },
    headerMeta: {
        fontSize: 12,
        fontWeight: '600',
    },
    emptyWrap: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 18,
    },
    emptyText: {
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },
    scrollContent: {
        paddingHorizontal: 12,
        paddingVertical: 12,
        rowGap: 8,
    },
    rowCard: {
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 10,
        minHeight: 64,
        paddingHorizontal: 10,
        paddingVertical: 10,
    },
    rowIconWrap: {
        alignItems: 'center',
        borderRadius: 11,
        height: 30,
        justifyContent: 'center',
        width: 30,
    },
    rowCopy: {
        flex: 1,
        minWidth: 0,
    },
    rowTitle: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 4,
    },
    rowMeta: {
        fontSize: 12,
        lineHeight: 16,
    },
}));
