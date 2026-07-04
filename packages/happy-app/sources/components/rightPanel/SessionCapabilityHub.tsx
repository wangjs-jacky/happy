import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAttachmentImage } from '@/hooks/useAttachmentImage';
import { imageViewer } from '@/sync/imageViewer';
import { t } from '@/text';
import { CapabilityBlockCard } from './CapabilityBlockCard';
import { CapabilityHubDetailView } from './CapabilityHubDetailView';
import type {
    CapabilityKey,
    FileCapabilityItem,
    ImageCapabilityItem,
    RecentResource,
} from './sessionCapabilityHubModel';
import { useSessionCapabilityHub } from './useSessionCapabilityHub';

const BLOCK_ORDER: CapabilityKey[] = ['skills', 'images', 'artifacts', 'files'];

export const SessionCapabilityHub = React.memo(function SessionCapabilityHub(props: {
    sessionId?: string;
}) {
    if (!props.sessionId) {
        return <CapabilityHubPlaceholder />;
    }
    return <SessionCapabilityHubInner sessionId={props.sessionId} />;
});

const SessionCapabilityHubInner = React.memo(function SessionCapabilityHubInner(props: {
    sessionId: string;
}) {
    const { theme } = useUnistyles();
    const model = useSessionCapabilityHub(props.sessionId);
    const [selectedKey, setSelectedKey] = React.useState<CapabilityKey | null>(null);

    React.useEffect(() => {
        setSelectedKey(null);
    }, [props.sessionId]);

    if (selectedKey) {
        return (
            <CapabilityHubDetailView
                count={model.details[selectedKey].length}
                items={model.details[selectedKey]}
                onBack={() => setSelectedKey(null)}
                sessionId={props.sessionId}
                title={t(`rightPanelCapabilityHub.blocks.${selectedKey}` as const)}
                type={selectedKey}
            />
        );
    }

    return (
        <ScrollView
            contentContainerStyle={styles.summaryContent}
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.heading}>
                <Text numberOfLines={1} style={[styles.headingTitle, { color: theme.colors.text }]}>
                    {t('rightPanelCapabilityHub.title')}
                </Text>
            </View>

            <View style={styles.grid}>
                {BLOCK_ORDER.map((key) => {
                    const block = model.blocks.find((entry) => entry.key === key);
                    if (!block) return null;
                    return (
                        <CapabilityBlockCard
                            count={block.count}
                            icon={renderBlockIcon(key, theme.colors.text)}
                            key={key}
                            onPress={() => setSelectedKey(key)}
                            preview={block.preview}
                            title={t(`rightPanelCapabilityHub.blocks.${key}` as const)}
                        />
                    );
                })}
            </View>

            <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                    {t('rightPanelCapabilityHub.recentTitle')}
                </Text>
                <Text style={[styles.sectionMeta, { color: theme.colors.textSecondary }]}>
                    {model.recentResources.length}
                </Text>
            </View>

            {model.recentResources.length === 0 ? (
                <View style={[styles.emptyRecent, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.emptyRecentText, { color: theme.colors.textSecondary }]}>
                        {t('rightPanelCapabilityHub.noRecent')}
                    </Text>
                </View>
            ) : (
                <View style={styles.recentList}>
                    {model.recentResources.map((item) => (
                        <RecentResourceRow
                            item={item}
                            key={item.id}
                            sessionId={props.sessionId}
                        />
                    ))}
                </View>
            )}
        </ScrollView>
    );
});

const CapabilityHubPlaceholder = React.memo(function CapabilityHubPlaceholder() {
    const { theme } = useUnistyles();

    return (
        <ScrollView
            contentContainerStyle={styles.summaryContent}
            showsVerticalScrollIndicator={false}
        >
            <View style={styles.heading}>
                <Text numberOfLines={1} style={[styles.headingTitle, { color: theme.colors.text }]}>
                    {t('rightPanelCapabilityHub.title')}
                </Text>
                <Text style={[styles.placeholderCopy, { color: theme.colors.textSecondary }]}>
                    {t('rightPanelCapabilityHub.emptyHomeDescription')}
                </Text>
            </View>

            <View style={styles.grid}>
                {BLOCK_ORDER.map((key) => (
                    <CapabilityBlockCard
                        count={0}
                        disabled={true}
                        icon={renderBlockIcon(key, theme.colors.textSecondary)}
                        key={key}
                        preview={null}
                        title={t(`rightPanelCapabilityHub.blocks.${key}` as const)}
                    />
                ))}
            </View>
        </ScrollView>
    );
});

const RecentResourceRow = React.memo(function RecentResourceRow(props: {
    item: RecentResource;
    sessionId: string;
}) {
    if (props.item.kind === 'image') {
        return <RecentImageRow item={props.item} sessionId={props.sessionId} />;
    }
    if (props.item.kind === 'file') {
        return <RecentFileRow item={props.item} sessionId={props.sessionId} />;
    }
    return <RecentArtifactRow item={props.item} />;
});

const RecentImageRow = React.memo(function RecentImageRow(props: {
    item: ImageCapabilityItem;
    sessionId: string;
}) {
    const { theme } = useUnistyles();
    const { uri } = useAttachmentImage(props.sessionId, props.item.ref);

    return (
        <Pressable
            disabled={!uri}
            onPress={uri ? () => imageViewer.open({ uri, width: props.item.width, height: props.item.height }) : undefined}
            style={({ pressed }) => [
                styles.recentRow,
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
            <View style={styles.recentCopy}>
                <Text numberOfLines={1} style={[styles.recentTitle, { color: theme.colors.text }]}>
                    {props.item.title}
                </Text>
                <Text numberOfLines={1} style={[styles.recentMeta, { color: theme.colors.textSecondary }]}>
                    {t('rightPanelCapabilityHub.meta.image')}
                </Text>
            </View>
            {!uri ? <ActivityIndicator color={theme.colors.textSecondary} size="small" /> : <Ionicons color={theme.colors.textSecondary} name="expand-outline" size={16} />}
        </Pressable>
    );
});

const RecentArtifactRow = React.memo(function RecentArtifactRow(props: {
    item: Extract<RecentResource, { kind: 'artifact' }>;
}) {
    const router = useRouter();
    const { theme } = useUnistyles();

    return (
        <Pressable
            onPress={() => router.push(`/artifacts/${props.item.artifactId}` as any)}
            style={({ pressed }) => [
                styles.recentRow,
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
            <View style={styles.recentCopy}>
                <Text numberOfLines={1} style={[styles.recentTitle, { color: theme.colors.text }]}>
                    {props.item.title}
                </Text>
                <Text numberOfLines={1} style={[styles.recentMeta, { color: theme.colors.textSecondary }]}>
                    {t('rightPanelCapabilityHub.meta.artifact')}
                </Text>
            </View>
            <Ionicons color={theme.colors.textSecondary} name="chevron-forward" size={16} />
        </Pressable>
    );
});

const RecentFileRow = React.memo(function RecentFileRow(props: {
    item: FileCapabilityItem;
    sessionId: string;
}) {
    const router = useRouter();
    const { theme } = useUnistyles();

    return (
        <Pressable
            onPress={() => router.push(`/session/${props.sessionId}/file?path=${btoa(props.item.path)}` as any)}
            style={({ pressed }) => [
                styles.recentRow,
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
            <View style={styles.recentCopy}>
                <Text numberOfLines={1} style={[styles.recentTitle, { color: theme.colors.text }]}>
                    {props.item.title}
                </Text>
                <Text numberOfLines={1} style={[styles.recentMeta, { color: theme.colors.textSecondary }]}>
                    {props.item.path}
                </Text>
            </View>
            <Ionicons color={theme.colors.textSecondary} name="chevron-forward" size={16} />
        </Pressable>
    );
});

function renderBlockIcon(key: CapabilityKey, color: string) {
    switch (key) {
        case 'skills':
            return <Ionicons color={color} name="flash-outline" size={16} />;
        case 'images':
            return <Ionicons color={color} name="image-outline" size={16} />;
        case 'artifacts':
            return <Ionicons color={color} name="document-text-outline" size={16} />;
        case 'files':
            return <Octicons color={color} name="file-code" size={15} />;
    }
}

const styles = StyleSheet.create(() => ({
    summaryContent: {
        paddingBottom: 24,
        paddingHorizontal: 12,
        paddingTop: 10,
    },
    heading: {
        marginBottom: 12,
        paddingHorizontal: 2,
    },
    headingTitle: {
        fontSize: 19,
        fontWeight: '700',
        letterSpacing: -0.4,
    },
    placeholderCopy: {
        fontSize: 13,
        lineHeight: 18,
        marginTop: 6,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: 10,
    },
    sectionHead: {
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
        marginTop: 16,
        paddingHorizontal: 2,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '700',
        letterSpacing: 0.2,
        textTransform: 'uppercase',
    },
    sectionMeta: {
        fontSize: 12,
        fontWeight: '600',
    },
    emptyRecent: {
        borderRadius: 16,
        borderWidth: 1,
        minHeight: 72,
        justifyContent: 'center',
        paddingHorizontal: 14,
    },
    emptyRecentText: {
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
    },
    recentList: {
        rowGap: 8,
    },
    recentRow: {
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 1,
        flexDirection: 'row',
        gap: 10,
        minHeight: 58,
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
    recentCopy: {
        flex: 1,
        minWidth: 0,
    },
    recentTitle: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 4,
    },
    recentMeta: {
        fontSize: 12,
        lineHeight: 16,
    },
}));
