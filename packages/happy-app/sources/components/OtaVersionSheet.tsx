import * as React from 'react';
import {
    ActivityIndicator,
    Animated,
    Modal as RNModal,
    Pressable,
    ScrollView,
    Text,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { Typography } from '@/constants/Typography';
import { useOtaVersion } from '@/hooks/useOtaVersions';
import { openExternalUrl } from '@/utils/openExternalUrl';
import {
    buildOtaVersionNotes,
    formatOtaVersionCalendarParts,
    formatOtaVersionCommit,
    formatOtaVersionDateTime,
    formatOtaVersionSummary,
    type OtaVersion,
} from '@/utils/otaVersions';

export interface OtaVersionSheetProps {
    visible: boolean;
    stamp: string | null;
    previewVersion?: OtaVersion | null;
    currentUpdateId: string | null;
    lockedStamp: string | null;
    appChannel: string | null;
    busy?: boolean;
    onClose: () => void;
    onLock: (stamp: string) => Promise<void>;
    onUnlock: () => Promise<void>;
}

function StatusPill(props: { label: string; tone?: 'neutral' | 'running' | 'locked' | 'warning' }) {
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
        <View style={[styles.pill, { backgroundColor }]}>
            <Text style={[styles.pillText, { color }]}>{props.label}</Text>
        </View>
    );
}

function MetaRow(props: { label: string; value: string }) {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    return (
        <View style={[styles.metaRow, { borderBottomColor: theme.colors.divider }]}>
            <Text style={styles.metaLabel}>{props.label}</Text>
            <Text style={styles.metaValue} numberOfLines={2}>
                {props.value}
            </Text>
        </View>
    );
}

function ActionButton(props: {
    label: string;
    tone?: 'primary' | 'secondary' | 'danger';
    disabled?: boolean;
    onPress?: () => void;
}) {
    const styles = stylesheet;
    const { theme } = useUnistyles();

    const backgroundColor = React.useMemo(() => {
        if (props.disabled) return theme.colors.surfaceHigh;
        if (props.tone === 'danger') return theme.colors.textDestructive ?? '#FF3B30';
        if (props.tone === 'secondary') return theme.colors.surfaceHigh;
        return theme.colors.button.primary.background;
    }, [props.disabled, props.tone, theme.colors.button.primary.background, theme.colors.surfaceHigh, theme.colors.textDestructive]);

    const textColor = React.useMemo(() => {
        if (props.disabled) return theme.colors.textSecondary;
        if (props.tone === 'secondary') return theme.colors.text;
        return theme.colors.button.primary.tint;
    }, [props.disabled, props.tone, theme.colors.button.primary.tint, theme.colors.text, theme.colors.textSecondary]);

    return (
        <Pressable
            disabled={props.disabled}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.actionButton,
                {
                    backgroundColor,
                    opacity: pressed && !props.disabled ? 0.82 : 1,
                },
            ]}
        >
            <Text style={[styles.actionButtonText, { color: textColor }]}>{props.label}</Text>
        </Pressable>
    );
}

export const OtaVersionSheet = React.memo(function OtaVersionSheet(props: OtaVersionSheetProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const [activeStamp, setActiveStamp] = React.useState<string | null>(props.stamp);
    const [cachedPreviewVersion, setCachedPreviewVersion] = React.useState<OtaVersion | null>(props.previewVersion ?? null);
    const { version: fetchedVersion, loading, error, refresh } = useOtaVersion(activeStamp, 'preview');
    const version = fetchedVersion ?? cachedPreviewVersion ?? null;
    const summary = version ? formatOtaVersionSummary(version) : null;
    const notes = version ? buildOtaVersionNotes(version) : '';
    const calendar = version ? formatOtaVersionCalendarParts(version) : null;
    const commit = version ? formatOtaVersionCommit(version) : '';
    const isRunning = !!version && !!props.currentUpdateId && version.id === props.currentUpdateId;
    const isLocked = !!version && version.stamp === props.lockedStamp;
    const sourceLabel = version?.display?.source?.number ? `PR #${version.display.source.number}` : '';
    const [rendered, setRendered] = React.useState(props.visible);
    const fadeAnim = React.useRef(new Animated.Value(0)).current;
    const slideAnim = React.useRef(new Animated.Value(40)).current;

    React.useEffect(() => {
        if (props.visible) {
            setActiveStamp(props.stamp);
            setCachedPreviewVersion(props.previewVersion ?? null);
        }
    }, [props.previewVersion, props.stamp, props.visible]);

    React.useEffect(() => {
        if (props.visible) {
            setRendered(true);
            fadeAnim.setValue(0);
            slideAnim.setValue(40);
            Animated.parallel([
                Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
                Animated.spring(slideAnim, { toValue: 0, damping: 22, stiffness: 240, useNativeDriver: true }),
            ]).start();
            return;
        }

        if (!rendered) return;

        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 40, duration: 160, useNativeDriver: true }),
        ]).start(({ finished }) => {
            if (finished) {
                setRendered(false);
                setActiveStamp(null);
                setCachedPreviewVersion(null);
            }
        });
    }, [fadeAnim, props.visible, rendered, slideAnim]);

    const handleOpenSource = React.useCallback(() => {
        if (!version?.display?.source?.url) return;
        void openExternalUrl(version.display.source.url);
    }, [version?.display?.source?.url]);

    const handlePrimaryAction = React.useCallback(() => {
        if (!version || props.appChannel !== 'preview' || props.busy) return;
        if (isLocked) {
            void props.onUnlock();
            return;
        }
        void props.onLock(version.stamp);
    }, [isLocked, props, version]);

    if (!rendered) return null;

    return (
        <RNModal visible transparent animationType="none" onRequestClose={props.onClose}>
            <View style={styles.overlay}>
                <TouchableWithoutFeedback onPress={props.onClose}>
                    <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
                </TouchableWithoutFeedback>

                <Animated.View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.modal.border,
                            paddingBottom: Math.max(18, safeArea.bottom),
                            transform: [{ translateY: slideAnim }],
                        },
                    ]}
                >
                    <View style={styles.handleRow}>
                        <View style={[styles.handle, { backgroundColor: theme.colors.textSecondary }]} />
                    </View>

                    <View style={styles.sheetHeader}>
                        <View style={styles.headerTopRow}>
                            <Text style={styles.eyebrow}>预览版本详情</Text>
                            <Pressable
                                onPress={props.onClose}
                                style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.72 }]}
                            >
                                <Ionicons name="close" size={18} color={theme.colors.textSecondary} />
                            </Pressable>
                        </View>

                        {loading && !summary ? (
                            <View style={styles.loadingState}>
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            </View>
                        ) : summary ? (
                            <>
                                <View style={styles.headerBadgeRow}>
                                    <StatusPill label={props.appChannel || 'unknown'} />
                                    {isRunning ? <StatusPill label="当前运行" tone="running" /> : null}
                                    {isLocked ? <StatusPill label="当前锁定" tone="locked" /> : null}
                                    {!isLocked && props.appChannel !== 'preview' ? <StatusPill label="仅浏览" tone="warning" /> : null}
                                </View>

                                <Text style={styles.headerTitle}>{summary.title}</Text>
                                <Text style={styles.headerMeta}>
                                    {sourceLabel ? `${sourceLabel} · ` : ''}
                                    {commit}
                                    {version?.git?.branch ? ` · ${version.git.branch}` : ''}
                                    {calendar ? ` · ${calendar.month} ${calendar.day} ${calendar.time}` : ''}
                                </Text>

                                <View style={styles.actionRow}>
                                    {version?.display?.source?.url ? (
                                        <ActionButton
                                            label="打开 PR"
                                            tone="secondary"
                                            disabled={props.busy}
                                            onPress={handleOpenSource}
                                        />
                                    ) : null}

                                    {props.appChannel === 'preview' ? (
                                        <ActionButton
                                            label={props.busy ? '正在拉取…' : (isLocked ? '拉取最新' : '拉取并切换')}
                                            tone={isLocked ? 'danger' : 'primary'}
                                            disabled={props.busy}
                                            onPress={handlePrimaryAction}
                                        />
                                    ) : (
                                        <ActionButton label="当前包不是 preview" tone="secondary" disabled />
                                    )}
                                </View>
                            </>
                        ) : (
                            <View style={styles.errorCard}>
                                <Text style={styles.errorTitle}>找不到这个 OTA 版本</Text>
                                <Text style={styles.errorText}>{error || '该版本元信息读取失败。'}</Text>
                                <ActionButton label="重试" tone="secondary" onPress={() => void refresh()} />
                            </View>
                        )}
                    </View>

                    {summary && version ? (
                        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
                            <View style={[styles.sectionCard, { borderColor: theme.colors.divider }]}>
                                <Text style={styles.sectionTitle}>发布内容</Text>
                                <MarkdownView markdown={notes} />
                            </View>

                            <View style={[styles.sectionCard, { borderColor: theme.colors.divider }]}>
                                <Text style={styles.sectionTitle}>版本信息</Text>
                                <MetaRow label="状态" value={isRunning && isLocked ? '当前运行 / 当前锁定' : (isRunning ? '当前运行' : (isLocked ? '当前锁定' : '历史版本'))} />
                                <MetaRow label="发布时间" value={formatOtaVersionDateTime(version)} />
                                <MetaRow label="提交" value={commit} />
                                <MetaRow label="分支" value={version.git?.branch || '未知'} />
                                <MetaRow label="Update ID" value={version.id} />
                                <MetaRow label="目标频道" value={version.channel} />
                            </View>
                        </ScrollView>
                    ) : null}
                </Animated.View>
            </View>
        </RNModal>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(7, 11, 19, 0.42)',
    },
    sheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '88%',
        overflow: 'hidden',
        borderWidth: 0.5,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 12,
        elevation: 12,
    },
    handleRow: {
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 10,
    },
    handle: {
        width: 42,
        height: 4,
        borderRadius: 999,
        opacity: 0.28,
    },
    sheetHeader: {
        paddingHorizontal: 20,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.divider,
    },
    headerTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    eyebrow: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        letterSpacing: 0.8,
        color: theme.colors.textSecondary,
    },
    closeButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHigh,
    },
    headerBadgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
    },
    pill: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    pillText: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        lineHeight: 14,
    },
    headerTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 22,
        lineHeight: 28,
        letterSpacing: -0.4,
    },
    headerMeta: {
        ...Typography.default(),
        marginTop: 8,
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 20,
    },
    actionRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 18,
    },
    actionButton: {
        flex: 1,
        minHeight: 46,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
    },
    actionButtonText: {
        ...Typography.default('semiBold'),
        fontSize: 15,
        lineHeight: 18,
    },
    sheetScroll: {
        flex: 1,
    },
    sheetScrollContent: {
        paddingHorizontal: 20,
        paddingTop: 18,
        gap: 14,
    },
    sectionCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 20,
        borderWidth: 0.5,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 16,
        lineHeight: 20,
        marginBottom: 12,
    },
    metaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    metaLabel: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 14,
        lineHeight: 18,
        flexShrink: 0,
    },
    metaValue: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 14,
        lineHeight: 18,
        flex: 1,
        textAlign: 'right',
    },
    loadingState: {
        paddingVertical: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    errorCard: {
        paddingVertical: 8,
        gap: 10,
    },
    errorTitle: {
        ...Typography.default('semiBold'),
        fontSize: 18,
        lineHeight: 22,
        color: theme.colors.text,
    },
    errorText: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
}));
