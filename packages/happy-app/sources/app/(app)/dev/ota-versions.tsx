import * as React from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { OtaVersionSheet } from '@/components/OtaVersionSheet';
import { Typography } from '@/constants/Typography';
import { Modal } from '@/modal';
import { useOtaVersions } from '@/hooks/useOtaVersions';
import { useOtaTarget } from '@/hooks/useOtaTarget';
import {
    buildOtaVersionPreview,
    formatOtaVersionCompactDate,
    formatOtaVersionCommit,
    formatOtaVersionSummary,
    type OtaVersion,
} from '@/utils/otaVersions';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

function StatusChip(props: { label: string; tone?: 'neutral' | 'running' | 'locked' | 'warning' }) {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    const backgroundColor = React.useMemo(() => {
        switch (props.tone) {
            case 'running':
                return theme.colors.success ? `${theme.colors.success}20` : '#34C75920';
            case 'locked':
                return theme.colors.button.primary.background ? `${theme.colors.button.primary.background}18` : '#0A84FF18';
            case 'warning':
                return '#FF950018';
            default:
                return theme.colors.surfaceHigh;
        }
    }, [props.tone, theme.colors.button.primary.background, theme.colors.success, theme.colors.surfaceHigh]);

    const color = React.useMemo(() => {
        switch (props.tone) {
            case 'running':
                return theme.colors.success ?? '#34C759';
            case 'locked':
                return theme.colors.button.primary.background ?? '#0A84FF';
            case 'warning':
                return '#FF9500';
            default:
                return theme.colors.textSecondary;
        }
    }, [props.tone, theme.colors.button.primary.background, theme.colors.success, theme.colors.textSecondary]);

    return (
        <View style={[styles.statusChip, { backgroundColor }]}>
            <Text style={[styles.statusChipText, { color }]}>{props.label}</Text>
        </View>
    );
}

function ReleaseSummaryCard(props: {
    title: string;
    subtitle: string;
    onPress?: () => void;
    disabled?: boolean;
    children?: React.ReactNode;
}) {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    return (
        <Pressable
            disabled={props.disabled}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.heroCard,
                {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.modal.border,
                    opacity: props.disabled ? 0.8 : 1,
                    transform: [{ scale: pressed && !props.disabled ? 0.992 : 1 }],
                },
            ]}
        >
            <View style={styles.heroTopRow}>
                <View style={styles.heroBadgeRow}>
                    {props.children}
                </View>
                {props.onPress ? (
                    <View style={styles.heroChevron}>
                        <Ionicons name="chevron-forward" size={16} color={theme.colors.textSecondary} />
                    </View>
                ) : null}
            </View>
            <Text style={styles.heroTitle}>{props.title}</Text>
            <Text style={styles.heroSubtitle}>{props.subtitle}</Text>
        </Pressable>
    );
}

export default function OtaVersionsScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const {
        versions,
        loading: listLoading,
        loadingMore,
        hasMore,
        loadedCount,
        totalCount,
        error,
        debug,
        refresh,
        loadMore,
    } = useOtaVersions('preview');
    const {
        lockedStamp,
        currentUpdateId,
        channel,
        loading: targetLoading,
        lockTo,
        unlock,
    } = useOtaTarget();
    const [selectedStamp, setSelectedStamp] = React.useState<string | null>(null);
    const [actionBusy, setActionBusy] = React.useState(false);

    const runningVersion = React.useMemo(
        () => versions.find((version) => version.id === currentUpdateId) ?? null,
        [currentUpdateId, versions],
    );
    const lockedVersion = React.useMemo(
        () => versions.find((version) => version.stamp === lockedStamp) ?? null,
        [lockedStamp, versions],
    );
    const featuredVersion = lockedVersion ?? runningVersion;
    const featuredStamp = lockedStamp ?? runningVersion?.stamp ?? null;
    const selectedPreviewVersion = React.useMemo(
        () => versions.find((version) => version.stamp === selectedStamp) ?? null,
        [selectedStamp, versions],
    );

    const openVersionSheet = React.useCallback((stamp: string | null) => {
        if (!stamp) return;
        setSelectedStamp(stamp);
    }, []);

    const handleLock = React.useCallback(async (stamp: string) => {
        try {
            setActionBusy(true);
            await lockTo(stamp);
        } catch (e) {
            setActionBusy(false);
            Modal.alert('切换失败', e instanceof Error ? e.message : String(e));
        }
    }, [lockTo]);

    const handleUnlock = React.useCallback(async () => {
        try {
            setActionBusy(true);
            await unlock();
        } catch (e) {
            setActionBusy(false);
            Modal.alert('解除锁定失败', e instanceof Error ? e.message : String(e));
        }
    }, [unlock]);

    const featuredSummary = featuredVersion ? formatOtaVersionSummary(featuredVersion) : null;

    const listHeader = React.useMemo(() => (
        <View style={styles.headerBlock}>
            <Text style={styles.sectionKicker}>当前设备</Text>

            <ReleaseSummaryCard
                title={featuredSummary?.title || (lockedStamp ? `已锁定 ${lockedStamp}` : '当前设备跟随最新 preview')}
                subtitle={
                    featuredSummary?.subtitle
                    || (currentUpdateId
                        ? `当前运行 ${currentUpdateId.slice(0, 8)}${lockedStamp ? ` · 锁定 ${lockedStamp}` : ''}`
                        : (lockedStamp ? `锁定到 ${lockedStamp}` : '当前还没有匹配到正在运行的 OTA 元信息'))
                }
                disabled={!featuredStamp}
                onPress={featuredStamp ? () => openVersionSheet(featuredStamp) : undefined}
            >
                <StatusChip label={channel || 'unknown'} />
                {runningVersion ? <StatusChip label="当前运行" tone="running" /> : null}
                {lockedStamp ? <StatusChip label="当前锁定" tone="locked" /> : <StatusChip label="跟随最新" tone="neutral" />}
                {channel !== 'preview' ? <StatusChip label="不可切换" tone="warning" /> : null}
            </ReleaseSummaryCard>

            <View style={styles.timelineHeaderRow}>
                <Text style={styles.timelineHeader}>版本时间线</Text>
                <Text style={styles.timelineCount}>{totalCount ? `${loadedCount} / ${totalCount}` : '0 / 0'}</Text>
            </View>
        </View>
    ), [channel, currentUpdateId, featuredStamp, featuredSummary, loadedCount, lockedStamp, openVersionSheet, runningVersion, styles.headerBlock, styles.sectionKicker, styles.timelineCount, styles.timelineHeader, styles.timelineHeaderRow, totalCount]);

    const listEmpty = React.useMemo(() => {
        if (listLoading) {
            return (
                <View style={styles.emptyState}>
                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    <Text style={styles.emptyText}>正在读取 preview 频道版本历史…</Text>
                </View>
            );
        }

        if (error) {
            return (
                <Pressable
                    style={({ pressed }) => [styles.messageCard, pressed && { opacity: 0.84 }]}
                    onPress={() => void refresh()}
                >
                    <Text style={styles.messageTitle}>加载失败，点此重试</Text>
                    <Text style={styles.messageBody}>{error}</Text>
                </Pressable>
            );
        }

        return (
            <View style={styles.emptyState}>
                <Text style={styles.emptyText}>该频道还没有发布过 OTA。</Text>
            </View>
        );
    }, [error, listLoading, refresh, styles.emptyState, styles.emptyText, styles.messageBody, styles.messageCard, styles.messageTitle, theme.colors.textSecondary]);

    const listFooter = React.useMemo(() => (
        <View style={styles.footerBlock}>
            {hasMore ? (
                <Pressable
                    onPress={() => void loadMore()}
                    style={({ pressed }) => [
                        styles.loadMoreCard,
                        {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.modal.border,
                            opacity: pressed ? 0.84 : 1,
                        },
                    ]}
                >
                    {loadingMore ? (
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    ) : (
                        <Ionicons name="download-outline" size={18} color={theme.colors.textSecondary} />
                    )}
                    <Text style={styles.loadMoreText}>
                        {loadingMore ? '正在加载更早版本…' : '加载更早版本'}
                    </Text>
                </Pressable>
            ) : null}

            <ItemGroup title="诊断" footer={debug || '拉取版本后，这里会显示请求诊断。'}>
                <Item
                    title="刷新版本列表"
                    loading={listLoading && versions.length > 0}
                    icon={<Ionicons name="reload-outline" size={29} color={theme.colors.text} />}
                    onPress={() => void refresh()}
                />
                <Item
                    title="复制诊断信息"
                    detail={totalCount ? `${loadedCount}/${totalCount}` : '空'}
                    copy={debug || 'no-debug'}
                    showChevron={false}
                    icon={<Ionicons name="bug-outline" size={29} color={theme.colors.textSecondary} />}
                />
            </ItemGroup>
        </View>
    ), [debug, hasMore, listLoading, loadedCount, loadingMore, loadMore, refresh, styles.footerBlock, styles.loadMoreCard, styles.loadMoreText, theme.colors.modal.border, theme.colors.surface, theme.colors.text, theme.colors.textSecondary, totalCount, versions.length]);

    const renderVersion = React.useCallback(({ item, index }: { item: OtaVersion; index: number }) => {
        const summary = formatOtaVersionSummary(item);
        const preview = buildOtaVersionPreview(item, 140);
        const compactDate = formatOtaVersionCompactDate(item);
        const commit = formatOtaVersionCommit(item);
        const isRunning = item.id === currentUpdateId;
        const isLocked = item.stamp === lockedStamp;
        const isLast = index === versions.length - 1;

        return (
            <View style={styles.timelineRow}>
                <View style={styles.timelineColumn}>
                    <View
                        style={[
                            styles.timelineDot,
                            {
                                backgroundColor: isLocked
                                    ? (theme.colors.button.primary.background ?? theme.colors.text)
                                    : (isRunning ? (theme.colors.success ?? '#34C759') : theme.colors.surfaceHigh),
                            },
                        ]}
                    />
                    {!isLast ? (
                        <View style={[styles.timelineRail, { backgroundColor: theme.colors.divider }]} />
                    ) : null}
                </View>

                <Pressable
                    onPress={() => openVersionSheet(item.stamp)}
                    style={({ pressed }) => [
                        styles.releaseCard,
                        {
                            backgroundColor: theme.colors.surface,
                            borderColor: isLocked
                                ? (theme.colors.button.primary.background ?? '#0A84FF')
                                : theme.colors.modal.border,
                            opacity: pressed ? 0.9 : 1,
                        },
                    ]}
                >
                    <View style={styles.releaseCardTopRow}>
                        <View style={styles.releaseHeaderStack}>
                            <Text style={styles.releaseDate}>{compactDate}</Text>
                            <View style={styles.releaseBadgeRow}>
                                {item.display?.source?.number ? <StatusChip label={`PR #${item.display.source.number}`} /> : null}
                                {isRunning ? <StatusChip label="当前运行" tone="running" /> : null}
                                {isLocked ? <StatusChip label="当前锁定" tone="locked" /> : null}
                            </View>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                    </View>

                    <Text style={styles.releaseTitle} numberOfLines={2}>
                        {summary.title}
                    </Text>
                    <Text style={styles.releasePreview} numberOfLines={2}>
                        {preview}
                    </Text>

                    <View style={styles.releaseMetaRow}>
                        <Text style={styles.releaseMeta}>{commit}</Text>
                        {item.git?.branch ? <Text style={styles.releaseMeta}>{item.git.branch}</Text> : null}
                    </View>
                </Pressable>
            </View>
        );
    }, [currentUpdateId, lockedStamp, openVersionSheet, styles.releaseBadgeRow, styles.releaseCard, styles.releaseCardTopRow, styles.releaseDate, styles.releaseHeaderStack, styles.releaseMeta, styles.releaseMetaRow, styles.releasePreview, styles.releaseTitle, styles.timelineColumn, styles.timelineDot, styles.timelineRail, styles.timelineRow, theme.colors.button.primary.background, theme.colors.divider, theme.colors.success, theme.colors.surface, theme.colors.surfaceHigh, theme.colors.text, theme.colors.textSecondary, versions.length]);

    return (
        <>
            <FlatList
                data={versions}
                keyExtractor={(item) => item.stamp}
                renderItem={renderVersion}
                style={styles.screen}
                contentContainerStyle={styles.contentContainer}
                ListHeaderComponent={listHeader}
                ListFooterComponent={listFooter}
                ListEmptyComponent={listEmpty}
                showsVerticalScrollIndicator={false}
                refreshing={listLoading && versions.length > 0}
                onRefresh={() => void refresh()}
                initialNumToRender={12}
                windowSize={8}
                removeClippedSubviews
            />

            <OtaVersionSheet
                visible={selectedStamp !== null}
                stamp={selectedStamp}
                previewVersion={selectedPreviewVersion}
                currentUpdateId={currentUpdateId}
                lockedStamp={lockedStamp}
                appChannel={channel}
                busy={actionBusy || targetLoading}
                onClose={() => {
                    if (!actionBusy) {
                        setSelectedStamp(null);
                    }
                }}
                onLock={handleLock}
                onUnlock={handleUnlock}
            />
        </>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    screen: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 28,
        gap: 12,
    },
    headerBlock: {
        gap: 12,
        marginBottom: 6,
    },
    sectionKicker: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 15,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    heroCard: {
        borderRadius: 20,
        borderWidth: 0.5,
        paddingHorizontal: 18,
        paddingVertical: 18,
    },
    heroTopRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
    },
    heroBadgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        flex: 1,
    },
    heroChevron: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHigh,
    },
    heroTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 21,
        lineHeight: 27,
        letterSpacing: -0.4,
        marginTop: 12,
    },
    heroSubtitle: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 8,
    },
    timelineHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginTop: 2,
    },
    timelineHeader: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 17,
        lineHeight: 21,
    },
    timelineCount: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 16,
    },
    statusChip: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    statusChipText: {
        ...Typography.default('semiBold'),
        fontSize: 11,
        lineHeight: 13,
    },
    timelineRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        gap: 12,
    },
    timelineColumn: {
        width: 18,
        alignItems: 'center',
        paddingTop: 18,
    },
    timelineDot: {
        width: 10,
        height: 10,
        borderRadius: 999,
        marginBottom: 8,
    },
    timelineRail: {
        width: 2,
        flex: 1,
        borderRadius: 999,
    },
    releaseCard: {
        flex: 1,
        borderRadius: 18,
        borderWidth: 0.5,
        paddingHorizontal: 16,
        paddingVertical: 15,
        minHeight: 126,
    },
    releaseCardTopRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
    },
    releaseHeaderStack: {
        flex: 1,
        gap: 8,
    },
    releaseDate: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 16,
        letterSpacing: 0.2,
    },
    releaseBadgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    releaseTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 17,
        lineHeight: 23,
        marginTop: 10,
    },
    releasePreview: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 19,
        marginTop: 7,
    },
    releaseMetaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    releaseMeta: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 16,
    },
    emptyState: {
        paddingVertical: 32,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    emptyText: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 20,
    },
    messageCard: {
        borderRadius: 22,
        borderWidth: 0.5,
        borderColor: theme.colors.modal.border,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 18,
        paddingVertical: 18,
    },
    messageTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 17,
        lineHeight: 22,
    },
    messageBody: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 8,
    },
    footerBlock: {
        gap: 10,
        marginTop: 4,
    },
    loadMoreCard: {
        borderRadius: 18,
        borderWidth: 0.5,
        minHeight: 54,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    loadMoreText: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 14,
        lineHeight: 18,
    },
}));
