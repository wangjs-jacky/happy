import * as React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@/utils/responsive';
import { useSession, useSessionMessages, useSetting } from '@/sync/storage';
import { sync } from '@/sync/sync';
import type { Session } from '@/sync/storageTypes';
import { isSessionTurnActive } from '@/hooks/useGroupedMessages';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { ChatFooter } from './ChatFooter';
import { ConversationTranscript } from './ConversationTranscript';
import type { TranscriptReadingAdapter } from './transcriptReading';

export const ChatList = React.memo((props: { session: Session }) => {
    const { messages, isLoaded, hasMoreOlder, isLoadingOlder, hasMoreNewer, isLoadingNewer, isAtLatest,
        olderError, newerError } = useSessionMessages(props.session.id);
    const session = useSession(props.session.id);
    const groupToolCalls = useSetting('groupToolCalls');
    const hasPendingPermission = Boolean(
        session?.agentState?.requests && Object.keys(session.agentState.requests).length > 0,
    );
    const { canFork, forkFromMessage, forkingFromMessageId } = useSessionQuickActions(session!, {});
    const handleForkFromMessage = React.useCallback((
        messageId: string,
        rewindPointId: string | undefined,
        messageText: string,
        retainSelectedTurn?: boolean,
        messageCreatedAt?: number,
    ) => {
        forkFromMessage({
            messageId,
            messageText,
            messageCreatedAt: messageCreatedAt ?? 0,
            rewindPointId,
            retainSelectedTurn,
        });
    }, [forkFromMessage]);
    const handleEditUserMessage = React.useCallback(async (messageId: string, messageText: string) => {
        await sync.sendMessage(props.session.id, messageText, {
            source: 'chat',
            editedFromMessageId: messageId,
        });
    }, [props.session.id]);
    const handleLoadOlder = React.useCallback(() => {
        if (!hasMoreOlder || isLoadingOlder) return;
        void sync.loadOlderMessages(props.session.id).catch(() => undefined);
    }, [hasMoreOlder, isLoadingOlder, props.session.id]);
    const handleLoadNewer = React.useCallback(() => {
        if (!hasMoreNewer || isLoadingNewer) return;
        void sync.loadNewerMessages(props.session.id).catch(() => undefined);
    }, [hasMoreNewer, isLoadingNewer, props.session.id]);
    const handleJumpToLatest = React.useCallback(() => sync.jumpToLatestMessages(props.session.id), [props.session.id]);
    const history = sync.getLocalHistoryScope();
    const reading = React.useMemo<TranscriptReadingAdapter | undefined>(() => {
        if (!history) return undefined;
        const id = props.session.id;
        const fence = history.captureSessionFence(id);
        const current = () => sync.getLocalHistoryScope() === history && history.isFenceCurrent(fence);
        return {
            key: JSON.stringify([history.scope, id]),
            read: async () => current() ? history.readReadingState(id) : null,
            save: async state => { if (current()) await history.writeReadingState(id, state); },
            wireId: renderedId => current() ? sync.getMessageWireId(id, renderedId) : null,
            wireSeq: renderedId => current() ? sync.getMessageWireSeq(id, renderedId) : null,
        };
    }, [history, props.session.id]);

    return (
        <ConversationTranscript
            metadata={props.session.metadata}
            sessionId={props.session.id}
            messages={messages}
            reading={reading}
            groupToolCalls={groupToolCalls}
            currentTurnActive={isAtLatest && isSessionTurnActive(session)}
            hasPendingPermission={isAtLatest && hasPendingPermission}
            onLoadOlder={handleLoadOlder}
            hasMoreOlder={hasMoreOlder || !isLoaded}
            isLoadingOlder={isLoadingOlder || !isLoaded}
            onLoadNewer={handleLoadNewer}
            onJumpToLatest={handleJumpToLatest}
            hasMoreNewer={hasMoreNewer}
            isLoadingNewer={isLoadingNewer}
            isAtLatest={isAtLatest}
            olderError={olderError}
            newerError={newerError}
            visualTop={<ListHeader />}
            visualBottom={isAtLatest ? <ListFooter sessionId={props.session.id} /> : null}
            showMessageActions={Platform.OS === 'web'}
            canEditLatestUserMessage={isAtLatest && session?.thinking !== true}
            onEditUserMessage={handleEditUserMessage}
            onForkFromMessage={canFork ? handleForkFromMessage : undefined}
            forkingFromMessageId={forkingFromMessageId}
        />
    );
});

const ListHeader = React.memo(() => {
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    return (
        <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', height: headerHeight + safeArea.top + 32 }} />
        </View>
    );
});

const ListFooter = React.memo((props: { sessionId: string }) => {
    const session = useSession(props.sessionId)!;
    return <ChatFooter controlledByUser={session.agentState?.controlledByUser || false} />;
});
