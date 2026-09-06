import * as React from 'react';
import {
    AppState,
    ActivityIndicator,
    FlatList,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Platform,
    Pressable,
    StyleProp,
    Text,
    View,
    ViewStyle,
} from 'react-native';
import { Octicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Metadata } from '@/sync/storageTypes';
import type { Message } from '@/sync/typesMessage';
import {
    type DisplayItem,
    type ToolGroupItem,
    useGroupedMessages,
} from '@/hooks/useGroupedMessages';
import { useUserMessageAnchors, type UserMessageAnchor } from '@/hooks/useUserMessageAnchors';
import { getAgentMessageForkTargets, type MessageForkTarget } from '@/utils/messageForkPoint';
import { BaseModal } from '@/modal/components/BaseModal';
import { t } from '@/text';
import { MessageView } from './MessageView';
import { AgentWorkGroupView, ToolGroupView } from './ToolGroupView';
import { AttachmentGalleryView } from './AttachmentGalleryView';
import { AnchorListSheet } from './AnchorListSheet';
import { expandedGroupKeys, groupIsExpanded, itemMessages, TranscriptReadingContext, TranscriptReadingMarker,
    TranscriptGroupExpansionContext, useTranscriptReading, type TranscriptReadingAdapter } from './transcriptReading';

const SCROLL_THRESHOLD = 300;
const ANCHOR_PILL_LINGER_MS = 1600;

type ForkFromMessage = (
    messageId: string,
    rewindPointId: string | undefined,
    messageText: string,
    retainSelectedTurn?: boolean,
    messageCreatedAt?: number,
) => void;

export type ConversationTranscriptProps = {
    metadata: Metadata | null;
    sessionId?: string;
    messages: Message[];
    reading?: TranscriptReadingAdapter;
    groupToolCalls?: boolean;
    currentTurnActive?: boolean;
    hasPendingPermission?: boolean;
    onLoadOlder?: () => void;
    hasMoreOlder?: boolean;
    isLoadingOlder?: boolean;
    onLoadNewer?: () => void;
    hasMoreNewer?: boolean;
    isLoadingNewer?: boolean;
    isAtLatest?: boolean;
    onJumpToLatest?: () => Promise<void>;
    olderError?: string | null;
    newerError?: string | null;
    visualTop?: React.ReactElement | null;
    visualBottom?: React.ReactElement | null;
    showMessageActions?: boolean;
    canEditLatestUserMessage?: boolean;
    onEditUserMessage?: (messageId: string, messageText: string) => Promise<void> | void;
    onForkFromMessage?: ForkFromMessage;
    forkingFromMessageId?: string | null;
    showAnchorNavigation?: boolean;
    showScrollToBottom?: boolean;
    inverted?: boolean;
    contentContainerStyle?: StyleProp<ViewStyle>;
};

export const ConversationTranscript = React.memo((props: ConversationTranscriptProps) => {
    const { theme } = useUnistyles();
    const flatListRef = React.useRef<FlatList>(null);
    const viewportRef = React.useRef<View>(null);
    const [showScrollButton, setShowScrollButton] = React.useState(false);
    const showScrollButtonRef = React.useRef(false);
    const [showAnchorPill, setShowAnchorPill] = React.useState(false);
    const [anchorSheetOpen, setAnchorSheetOpen] = React.useState(false);
    const anchorPillVisibleRef = React.useRef(false);
    const anchorPillTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const indexRetryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const groupingOptions = React.useMemo(
        () => ({ currentTurnActive: props.currentTurnActive ?? false }),
        [props.currentTurnActive],
    );
    const displayItems = useGroupedMessages(props.messages, props.groupToolCalls ?? true, groupingOptions);
    const inverted = props.inverted ?? true;
    const isAtLatest = props.isAtLatest ?? true;
    const [boundaries, setBoundaries] = React.useState({ older: false, newer: false });
    const attempted = React.useRef(new Set<string>());
    const jumpPending = React.useRef(false);
    const loadBoundary = React.useCallback((direction: 'older' | 'newer', retry = false) => {
        const loading = direction === 'older' ? props.isLoadingOlder : props.isLoadingNewer;
        const more = direction === 'older' ? props.hasMoreOlder : props.hasMoreNewer;
        const error = direction === 'older' ? props.olderError : props.newerError;
        const load = direction === 'older' ? props.onLoadOlder : props.onLoadNewer;
        const boundary = direction === 'older' ? props.messages.at(-1)?.id : props.messages[0]?.id;
        const key = JSON.stringify([props.sessionId, direction, boundary]);
        if (!load || more === false || loading || (!retry && (error || attempted.current.has(key)))) return;
        attempted.current.add(key);
        if (attempted.current.size > 8) attempted.current.delete(attempted.current.values().next().value!);
        load();
    }, [props.sessionId, props.messages, props.hasMoreOlder, props.hasMoreNewer, props.isLoadingOlder, props.isLoadingNewer,
        props.onLoadOlder, props.onLoadNewer, props.olderError, props.newerError]);
    const listItems = React.useMemo(
        () => inverted ? displayItems : [...displayItems].reverse(),
        [displayItems, inverted],
    );
    const latestVisibleUserMessageId = React.useMemo(() => {
        for (const item of displayItems) {
            if (item.type === 'message' && item.message.kind === 'user-text') return item.message.id;
        }
        return null;
    }, [displayItems]);
    const anchors = useUserMessageAnchors(displayItems);
    const anchorsRef = React.useRef(anchors);
    anchorsRef.current = anchors;
    const hasAnchorNavigation = anchors.length > 0 || props.hasMoreOlder === true;

    const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => {
        const initial = new Set<string>();
        for (const item of displayItems) {
            if (isCollapsibleDisplayItem(item) && !item.hasPendingPermission) initial.add(item.id);
        }
        return initial;
    });
    const manuallyCollapsedRef = React.useRef<Set<string>>(new Set());
    const [expandedKeys, setExpandedKeys] = React.useState<string[]>([]);
    const reading = useTranscriptReading({ adapter: props.reading, items: listItems, inverted, isAtLatest,
        listRef: flatListRef, viewportRef, expanded: expandedKeys, restoreExpanded: setExpandedKeys });
    const seenCollapsibleGroupsRef = React.useRef<Set<string>>(new Set(
        displayItems.filter(isCollapsibleDisplayItem).map((item) => item.id),
    ));

    React.useEffect(() => {
        setCollapsedGroups((previous) => {
            let changed = false;
            const next = new Set(previous);
            for (const item of displayItems) {
                if (!isCollapsibleDisplayItem(item)) continue;
                if (props.reading && groupIsExpanded(item, expandedKeys, props.reading.wireId)) {
                    if (next.delete(item.id)) changed = true;
                    seenCollapsibleGroupsRef.current.add(item.id);
                    continue;
                }
                const isNew = !seenCollapsibleGroupsRef.current.has(item.id);
                if (isNew) seenCollapsibleGroupsRef.current.add(item.id);
                if (isAtLatest && item.hasPendingPermission && next.has(item.id) && !manuallyCollapsedRef.current.has(item.id)) {
                    next.delete(item.id);
                    changed = true;
                } else if (isNew && !item.hasPendingPermission) {
                    next.add(item.id);
                    changed = true;
                }
            }
            return changed ? next : previous;
        });
    }, [displayItems, expandedKeys, props.reading, isAtLatest]);

    const displayItemsRef = React.useRef(displayItems);
    displayItemsRef.current = displayItems;
    React.useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active' || props.reading) return;
            setCollapsedGroups((previous) => {
                const next = new Set(previous);
                for (const item of displayItemsRef.current) {
                    if (isCollapsibleDisplayItem(item) && !item.hasRunning) next.add(item.id);
                }
                return next;
            });
        });
        return () => subscription.remove();
    }, [props.reading]);

    const latestUserMessageId = React.useMemo(() => {
        for (const message of props.messages) {
            if (message.kind === 'user-text') return message.id;
        }
        return null;
    }, [props.messages]);
    const previousUserMessageIdRef = React.useRef(latestUserMessageId);
    React.useEffect(() => {
        if (!latestUserMessageId || latestUserMessageId === previousUserMessageIdRef.current) return;
        previousUserMessageIdRef.current = latestUserMessageId;
        if (!isAtLatest || props.reading) return;
        manuallyCollapsedRef.current.clear();
        setCollapsedGroups((previous) => {
            const next = new Set(previous);
            for (const item of displayItemsRef.current) {
                if (isCollapsibleDisplayItem(item)) next.add(item.id);
            }
            return next;
        });
    }, [latestUserMessageId, isAtLatest, props.reading]);

    const handleToggleGroup = React.useCallback((groupId: string) => {
        reading.pin();
        if (props.reading) {
            const item = displayItemsRef.current.find(item => item.id === groupId);
            if (item) setExpandedKeys(previous => {
                if (collapsedGroups.has(groupId)) return [...previous, ...expandedGroupKeys([item], new Set(), props.reading!.wireId)];
                const members = new Set(itemMessages(item).map(message => props.reading!.wireId(message.id)));
                return previous.filter(key => {
                    try { const [kind, wire] = JSON.parse(key); return kind !== item.type || !members.has(wire); } catch { return false; }
                });
            });
        }
        setCollapsedGroups((previous) => {
            const next = new Set(previous);
            if (next.has(groupId)) {
                next.delete(groupId);
                manuallyCollapsedRef.current.delete(groupId);
            } else {
                next.add(groupId);
                manuallyCollapsedRef.current.add(groupId);
            }
            return next;
        });
    }, [collapsedGroups, props.reading, reading]);
    const nestedExpansion = props.reading ? {
        isExpanded: (item: DisplayItem) => groupIsExpanded(item, expandedKeys, props.reading!.wireId)
            || (isAtLatest && isCollapsibleDisplayItem(item) && item.hasPendingPermission && !manuallyCollapsedRef.current.has(item.id)),
        toggle: (item: DisplayItem) => {
            reading.pin();
            const expanded = groupIsExpanded(item, expandedKeys, props.reading!.wireId);
            if (expanded) manuallyCollapsedRef.current.add(item.id); else manuallyCollapsedRef.current.delete(item.id);
            setExpandedKeys(previous => {
                if (!expanded) return [...previous, ...expandedGroupKeys([item], new Set(), props.reading!.wireId)];
                const members = new Set(itemMessages(item).map(message => props.reading!.wireId(message.id)));
                return previous.filter(key => { try { const [kind, wire] = JSON.parse(key); return kind !== item.type || !members.has(wire); } catch { return false; } });
            });
        },
    } : null;
    const agentForkTargets = React.useMemo<Map<string, MessageForkTarget>>(
        () => getAgentMessageForkTargets(props.messages, {
            flavor: props.metadata?.flavor === 'codex' ? 'codex' : 'claude',
            allowMissingRewindPoint: props.metadata?.flavor === 'codex',
        }),
        [props.messages, props.metadata?.flavor],
    );
    const renderItemContent = React.useCallback(({ item }: { item: DisplayItem }) => {
        if (item.type === 'tool-group') {
            return (
                <ToolGroupView
                    group={item}
                    metadata={props.metadata}
                    sessionId={props.sessionId}
                    expanded={!collapsedGroups.has(item.id)}
                    onToggle={() => handleToggleGroup(item.id)}
                />
            );
        }
        if (item.type === 'image-group') {
            return (
                <AttachmentGalleryView
                    messages={item.messages}
                    sessionId={props.sessionId}
                    presentation={item.presentation}
                    pendingCount={item.pendingCount}
                    pendingStartedAt={item.pendingStartedAt}
                />
            );
        }
        if (item.type === 'agent-work-group') {
            return (
                <AgentWorkGroupView
                    group={item}
                    metadata={props.metadata}
                    sessionId={props.sessionId}
                    expanded={!collapsedGroups.has(item.id)}
                    onToggle={() => handleToggleGroup(item.id)}
                />
            );
        }
        return (
            <MessageView
                message={item.message}
                metadata={props.metadata}
                sessionId={props.sessionId}
                onForkFromMessage={props.onForkFromMessage}
                forkingFromMessageId={props.forkingFromMessageId}
                agentForkTarget={item.message.kind === 'agent-text' ? agentForkTargets.get(item.message.id) : undefined}
                showAgentMessageActions={props.showMessageActions}
                showUserMessageActions={props.showMessageActions}
                canEditUserMessage={Boolean(
                    props.canEditLatestUserMessage
                    && item.message.kind === 'user-text'
                    && item.message.id === latestVisibleUserMessageId
                    && !props.hasPendingPermission
                )}
                onEditUserMessage={props.onEditUserMessage}
            />
        );
    }, [
        agentForkTargets,
        collapsedGroups,
        handleToggleGroup,
        latestVisibleUserMessageId,
        props.canEditLatestUserMessage,
        props.hasPendingPermission,
        props.metadata,
        props.onEditUserMessage,
        props.onForkFromMessage,
        props.forkingFromMessageId,
        props.sessionId,
        props.showMessageActions,
    ]);
    const renderItem = React.useCallback(({ item }: { item: DisplayItem }) => (
        <TranscriptReadingMarker messageId={itemMessages(item)[0]?.id ?? item.id}>
            {renderItemContent({ item })}
        </TranscriptReadingMarker>
    ), [renderItemContent]);

    const handleScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const distanceFromBottom = inverted
            ? contentOffset.y
            : Math.max(0, contentSize.height - layoutMeasurement.height - contentOffset.y);
        reading.scroll(contentOffset.y, distanceFromBottom);
        const distanceFromTop = inverted ? Math.max(0, contentSize.height - layoutMeasurement.height - contentOffset.y) : contentOffset.y;
        setBoundaries(previous => previous.older === (distanceFromTop <= 24) && previous.newer === (distanceFromBottom <= 24)
            ? previous : { older: distanceFromTop <= 24, newer: distanceFromBottom <= 24 });
        if (!isAtLatest && distanceFromBottom <= 2 * layoutMeasurement.height) loadBoundary('newer');
        if (props.hasMoreOlder && ((!inverted && distanceFromTop <= 2 * layoutMeasurement.height) || distanceFromTop <= 24)) loadBoundary('older');
        const next = distanceFromBottom > SCROLL_THRESHOLD;
        if (next !== showScrollButtonRef.current) {
            showScrollButtonRef.current = next;
            setShowScrollButton(next);
        }
        if (props.showAnchorNavigation !== false && hasAnchorNavigation) {
            if (!anchorPillVisibleRef.current) {
                anchorPillVisibleRef.current = true;
                setShowAnchorPill(true);
            }
            if (anchorPillTimerRef.current) clearTimeout(anchorPillTimerRef.current);
            anchorPillTimerRef.current = setTimeout(() => {
                anchorPillVisibleRef.current = false;
                setShowAnchorPill(false);
            }, ANCHOR_PILL_LINGER_MS);
        }
    }, [hasAnchorNavigation, inverted, isAtLatest, loadBoundary, reading, props.hasMoreOlder, props.showAnchorNavigation]);

    React.useEffect(() => () => {
        if (anchorPillTimerRef.current) clearTimeout(anchorPillTimerRef.current);
        if (indexRetryTimerRef.current) clearTimeout(indexRetryTimerRef.current);
    }, []);

    const scrollLatest = React.useCallback(() => {
        reading.jumpLatest();
        if (inverted) flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        else flatListRef.current?.scrollToEnd({ animated: true });
    }, [inverted, reading]);
    const sessionRef = React.useRef(props.sessionId); sessionRef.current = props.sessionId;
    const scrollToBottom = React.useCallback(async () => {
        if (isAtLatest) { scrollLatest(); return; }
        if (!props.onJumpToLatest || jumpPending.current) return;
        const session = props.sessionId;
        jumpPending.current = true;
        try { await props.onJumpToLatest(); }
        catch { if (sessionRef.current === session) jumpPending.current = false; }
    }, [isAtLatest, scrollLatest, props.onJumpToLatest, props.sessionId]);
    const onContentSizeChange = React.useCallback(() => {
        if (jumpPending.current && isAtLatest) { jumpPending.current = false; scrollLatest(); }
        else void reading.layout();
    }, [isAtLatest, scrollLatest, reading]);
    React.useEffect(() => {
        if (props.newerError) jumpPending.current = false;
        else if (jumpPending.current && isAtLatest) { jumpPending.current = false; scrollLatest(); }
    }, [isAtLatest, props.newerError, scrollLatest]);
    const scrollToAnchor = React.useCallback((anchor: UserMessageAnchor) => {
        // History loads and incoming messages can shift indexes while the
        // sheet is open. Resolve the stable id against the current transcript.
        const current = anchorsRef.current.find((candidate) => candidate.id === anchor.id);
        if (!current) return;
        const index = inverted ? current.displayIndex : displayItemsRef.current.length - 1 - current.displayIndex;
        flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    }, [inverted]);
    const handleScrollToIndexFailed = React.useCallback((info: { index: number; averageItemLength: number }) => {
        flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        if (indexRetryTimerRef.current) clearTimeout(indexRetryTimerRef.current);
        const session = sessionRef.current;
        indexRetryTimerRef.current = setTimeout(() => {
            if (sessionRef.current !== session) return;
            flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
        }, 120);
    }, []);
    const openAnchorSheet = React.useCallback(() => setAnchorSheetOpen(true), []);
    const closeAnchorSheet = React.useCallback(() => setAnchorSheetOpen(false), []);

    React.useEffect(() => {
        setAnchorSheetOpen(false);
        if (indexRetryTimerRef.current) clearTimeout(indexRetryTimerRef.current);
        jumpPending.current = false;
        attempted.current.clear();
        setBoundaries({ older: false, newer: false });
    }, [props.sessionId]);

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const node = (flatListRef.current as any)?.getScrollableNode?.() as HTMLElement | undefined;
        if (!node) return;
        const handler = (event: WheelEvent) => {
            if (event.shiftKey && Math.abs(event.deltaX) > 0 && Math.abs(event.deltaY) < 1) {
                node.scrollTop += event.deltaX;
                event.preventDefault();
            }
        };
        node.addEventListener('wheel', handler, { passive: false });
        return () => node.removeEventListener('wheel', handler);
    }, []);

    return (
        <TranscriptReadingContext.Provider value={reading.markers}>
        <TranscriptGroupExpansionContext.Provider value={nestedExpansion}>
        <View ref={viewportRef} collapsable={false} style={styles.container}>
            <FlatList
                ref={flatListRef}
                testID="conversation-transcript-list"
                data={listItems}
                inverted={inverted}
                keyExtractor={(item) => item.id}
                maintainVisibleContentPosition={inverted
                    ? { minIndexForVisible: 0, ...(isAtLatest ? { autoscrollToTopThreshold: 50 } : {}) }
                    : undefined}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
                contentContainerStyle={props.contentContainerStyle}
                renderItem={renderItem}
                onScroll={handleScroll}
                onScrollBeginDrag={reading.cancelRestore}
                onContentSizeChange={onContentSizeChange}
                scrollEventThrottle={16}
                ListHeaderComponent={(inverted ? props.visualBottom : props.visualTop) ?? undefined}
                ListFooterComponent={(inverted ? props.visualTop : props.visualBottom) ?? undefined}
                onEndReached={() => loadBoundary(inverted ? 'older' : 'newer')}
                // Start the next backward page before the user reaches the
                // visual top. Existing messages stay interactive while the
                // request runs, and the loading affordance is normally kept
                // outside the viewport instead of flashing on every page.
                onEndReachedThreshold={2}
                onScrollToIndexFailed={handleScrollToIndexFailed}
            />
            <HistoryBoundary direction="older" reached={boundaries.older} loading={props.isLoadingOlder}
                error={props.olderError} retry={() => loadBoundary('older', true)} />
            <HistoryBoundary direction="newer" reached={boundaries.newer && !isAtLatest} loading={props.isLoadingNewer}
                error={props.newerError} retry={() => loadBoundary('newer', true)} />
            {props.showAnchorNavigation !== false && showAnchorPill && hasAnchorNavigation ? (
                <Animated.View
                    entering={FadeIn.duration(180)}
                    exiting={FadeOut.duration(260)}
                    style={[styles.anchorPillContainer, { pointerEvents: 'box-none' }]}
                >
                    <Pressable testID="conversation-anchors-button" accessibilityRole="button" onPress={openAnchorSheet} style={({ pressed }) => [styles.anchorPill, pressed && styles.anchorPillPressed]}>
                        <Octicons name="list-unordered" size={14} color={theme.colors.text} />
                        <Text style={styles.anchorPillLabel}>{t('session.anchorsButton')}</Text>
                        <Text testID="conversation-anchors-count" style={styles.anchorPillCount}>{props.hasMoreOlder ? `${anchors.length}+` : anchors.length}</Text>
                    </Pressable>
                </Animated.View>
            ) : null}
            {props.showAnchorNavigation !== false && anchorSheetOpen ? (
                <BaseModal visible onClose={closeAnchorSheet} accessibilityLabel={t('session.anchorsTitle')}>
                    <AnchorListSheet
                        anchors={anchors}
                        hasMoreOlder={props.hasMoreOlder}
                        isLoadingOlder={props.isLoadingOlder}
                        onLoadOlder={props.onLoadOlder}
                        onSelect={scrollToAnchor}
                        onClose={closeAnchorSheet}
                    />
                </BaseModal>
            ) : null}
            {props.showScrollToBottom !== false && (showScrollButton || !isAtLatest) ? (
                <View style={styles.scrollButtonContainer}>
                    <Pressable
                        testID="conversation-scroll-to-bottom"
                        accessibilityRole="button"
                        accessibilityLabel={t('session.scrollToBottom')}
                        style={({ pressed }) => [styles.scrollButton, pressed ? styles.scrollButtonPressed : styles.scrollButtonDefault]}
                        onPress={() => { void scrollToBottom(); }}
                    >
                        <Octicons testID="conversation-scroll-to-bottom-icon" name="arrow-down" size={14} color={theme.colors.text} />
                    </Pressable>
                </View>
            ) : null}
        </View>
        </TranscriptGroupExpansionContext.Provider>
        </TranscriptReadingContext.Provider>
    );
});

function HistoryBoundary(props: { direction: 'older' | 'newer'; reached: boolean; loading?: boolean; error?: string | null; retry: () => void }) {
    const { theme } = useUnistyles();
    const [visible, setVisible] = React.useState(false);
    React.useEffect(() => {
        setVisible(false);
        if (!props.reached || !props.loading) return;
        const timer = setTimeout(() => setVisible(true), 250);
        return () => clearTimeout(timer);
    }, [props.reached, props.loading]);
    if (!props.reached || (!visible && !props.error)) return null;
    return <View style={{ position: 'absolute', [props.direction === 'older' ? 'top' : 'bottom']: 0, left: 0, right: 0,
        height: 36, alignItems: 'center', justifyContent: 'center' }}>
        {props.error ? <Pressable testID={`history-${props.direction}-retry`} accessibilityRole="button" onPress={props.retry}>
            <Text style={{ color: theme.colors.text }}>{t('common.retry')}</Text>
        </Pressable> : <ActivityIndicator testID={`history-${props.direction}-loading`} size="small" />}
    </View>;
}

function isCollapsibleDisplayItem(
    item: DisplayItem,
): item is ToolGroupItem | Extract<DisplayItem, { type: 'agent-work-group' }> {
    return item.type === 'tool-group' || item.type === 'agent-work-group';
}

const styles = StyleSheet.create((theme) => ({
    container: { flex: 1 },
    scrollButtonContainer: {
        position: 'absolute', right: 16, bottom: 16, alignItems: 'flex-end', justifyContent: 'center', pointerEvents: 'box-none',
    },
    scrollButton: {
        borderRadius: 16, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
        borderColor: theme.colors.divider, shadowColor: theme.colors.shadow.color, shadowOffset: { width: 0, height: 1 },
        shadowRadius: 2, shadowOpacity: theme.colors.shadow.opacity * 0.5, elevation: 2,
    },
    scrollButtonDefault: { backgroundColor: theme.colors.surface, opacity: 0.9 },
    scrollButtonPressed: { backgroundColor: theme.colors.surface, opacity: 0.7 },
    anchorPillContainer: {
        position: 'absolute', right: 16, bottom: 60, alignItems: 'flex-end', justifyContent: 'center', pointerEvents: 'box-none',
    },
    anchorPill: {
        flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 14, height: 34,
        borderRadius: 17, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface,
        shadowColor: theme.colors.shadow.color, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6,
        shadowOpacity: theme.colors.shadow.opacity, elevation: 3,
    },
    anchorPillPressed: { opacity: 0.7 },
    anchorPillLabel: { fontSize: 13, fontWeight: '600' as const, color: theme.colors.text },
    anchorPillCount: { fontSize: 11, fontWeight: '700' as const, color: theme.colors.textSecondary },
}));
