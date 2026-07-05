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
    QuickPromptCapabilityItem,
} from './sessionCapabilityHubModel';

type Props = {
    count: number;
    items: CapabilityItem[];
    onAddQuickPrompt?: () => void;
    onBack: () => void;
    onDeleteQuickPrompt?: (item: QuickPromptCapabilityItem) => void;
    onRunQuickPrompt?: (item: QuickPromptCapabilityItem) => void;
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
                {props.type === 'quickPrompts' && props.onAddQuickPrompt ? (
                    <Pressable hitSlop={8} onPress={props.onAddQuickPrompt} style={[styles.addButton, { backgroundColor: theme.colors.surfaceHigh }]}>
                        <Ionicons color={theme.colors.text} name="add" size={18} />
                    </Pressable>
                ) : null}
            </View>

            {props.items.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                        {t(`rightPanelCapabilityHub.empty.${props.type}` as const)}
                    </Text>
                    {props.type === 'quickPrompts' && props.onAddQuickPrompt ? (
                        <Pressable
                            onPress={props.onAddQuickPrompt}
                            style={({ pressed }) => [
                                styles.emptyAction,
                                {
                                    backgroundColor: theme.colors.button.primary.background,
                                    opacity: pressed ? 0.82 : 1,
                                },
                            ]}
                        >
                            <Text style={[styles.emptyActionText, { color: theme.colors.button.primary.tint }]}>
                                {t('rightPanelCapabilityHub.quickPrompt.add')}
                            </Text>
                        </Pressable>
                    ) : null}
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
                            onDeleteQuickPrompt={props.onDeleteQuickPrompt}
                            onRunQuickPrompt={props.onRunQuickPrompt}
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
    onDeleteQuickPrompt?: (item: QuickPromptCapabilityItem) => void;
    onRunQuickPrompt?: (item: QuickPromptCapabilityItem) => void;
    sessionId: string;
}) {
    if (props.item.kind === 'quickPrompt') {
        return (
            <QuickPromptItemRow
                item={props.item}
                onDelete={props.onDeleteQuickPrompt}
                onRun={props.onRunQuickPrompt}
            />
        );
    }
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

const QuickPromptItemRow = React.memo(function QuickPromptItemRow(props: {
    item: QuickPromptCapabilityItem;
    onDelete?: (item: QuickPromptCapabilityItem) => void;
    onRun?: (item: QuickPromptCapabilityItem) => void;
}) {
    const { theme } = useUnistyles();

    return (
        <View style={[styles.rowCard, styles.quickPromptCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
            <Pressable
                disabled={!props.onRun}
                onPress={() => props.onRun?.(props.item)}
                style={({ pressed }) => [
                    styles.quickPromptMain,
                    { opacity: pressed ? 0.72 : 1 },
                ]}
            >
                <View style={[styles.rowIconWrap, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Ionicons color={theme.colors.text} name="chatbubble-ellipses-outline" size={15} />
                </View>
                <View style={styles.rowCopy}>
                    <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.colors.text }]}>
                        {props.item.title}
                    </Text>
                    <Text numberOfLines={2} style={[styles.rowMeta, { color: theme.colors.textSecondary }]}>
                        {props.item.prompt}
                    </Text>
                </View>
                <Text style={[styles.sendText, { color: theme.colors.textLink }]}>
                    {t('rightPanelCapabilityHub.quickPrompt.send')}
                </Text>
            </Pressable>
            {props.onDelete ? (
                <Pressable
                    hitSlop={8}
                    onPress={() => props.onDelete?.(props.item)}
                    style={({ pressed }) => [
                        styles.deleteButton,
                        {
                            backgroundColor: theme.colors.surfaceHigh,
                            opacity: pressed ? 0.72 : 1,
                        },
                    ]}
                >
                    <Ionicons color={theme.colors.textSecondary} name="trash-outline" size={15} />
                </Pressable>
            ) : null}
        </View>
    );
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
    addButton: {
        alignItems: 'center',
        borderRadius: 14,
        height: 28,
        justifyContent: 'center',
        width: 28,
    },
    emptyWrap: {
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 18,
    },
    emptyText: {
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },
    emptyAction: {
        alignItems: 'center',
        borderRadius: 12,
        justifyContent: 'center',
        marginTop: 14,
        minHeight: 40,
        paddingHorizontal: 16,
    },
    emptyActionText: {
        fontSize: 14,
        fontWeight: '700',
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
    quickPromptCard: {
        alignItems: 'stretch',
        gap: 0,
        paddingRight: 8,
    },
    quickPromptMain: {
        alignItems: 'center',
        flex: 1,
        flexDirection: 'row',
        gap: 10,
        minWidth: 0,
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
    sendText: {
        fontSize: 12,
        fontWeight: '700',
        marginLeft: 4,
    },
    deleteButton: {
        alignItems: 'center',
        borderRadius: 14,
        height: 28,
        justifyContent: 'center',
        marginLeft: 8,
        width: 28,
    },
}));
