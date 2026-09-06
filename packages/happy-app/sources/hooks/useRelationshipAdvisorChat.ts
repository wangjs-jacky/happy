import * as React from 'react';
import { randomUUID } from 'expo-crypto';

import type { AttachmentPreview } from '@/sync/attachmentTypes';
import {
    relationshipAdvisorClient,
    type RelationshipAdvisorEvent,
} from '@/sync/relationshipAdvisorClient';
import {
    discardRelationshipAdvisorImages,
    relationshipAdvisorImageKeys,
    saveRelationshipAdvisorImages,
    uploadRelationshipAdvisorHistory,
} from '@/sync/relationshipAdvisorImages';
import { deleteAdvisorImages } from '@/sync/relationshipAdvisorImageCache';
import { useLocalSetting, useLocalSettingUpdater } from '@/sync/storage';
import {
    relationshipAdvisorChatReducer,
    type RelationshipAdvisorChatMessage,
} from '@/components/relationship-advisor/relationshipAdvisorChatModel';
import {
    buildRelationshipAdvisorConversationTitle,
    saveRelationshipAdvisorConversation,
} from '@/components/relationship-advisor/relationshipAdvisorHistoryModel';

/** Owns one cloud generation, token stream, image uploads, and its device-local conversation. */
export function useRelationshipAdvisorChat(conversationId: string) {
    const conversations = useLocalSetting('relationshipAdvisorConversations');
    const updateConversations = useLocalSettingUpdater('relationshipAdvisorConversations');
    const conversation = conversations.find(({ id }) => id === conversationId);
    const [state, dispatch] = React.useReducer(relationshipAdvisorChatReducer, {
        messages: conversation?.messages ?? [],
        activeRequestId: null,
        streamingText: '',
        error: null,
    });
    const persistedMessagesRef = React.useRef(conversation?.messages ?? []);
    const unsubscribeRef = React.useRef<(() => void) | null>(null);
    const activeRequestIdRef = React.useRef<string | null>(null);
    const providerStartedRequestIdRef = React.useRef<string | null>(null);
    const cancelledRequestIdsRef = React.useRef(new Set<string>());
    const lastAttemptRef = React.useRef<{ text: string; images: AttachmentPreview[]; imageKeys?: string[]; userId: string } | null>(null);
    const [canRetry, setCanRetry] = React.useState(false);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
        if (persistedMessagesRef.current === state.messages) return;
        persistedMessagesRef.current = state.messages;
        const messages = state.messages.length > 50 ? state.messages.slice(-50) : state.messages;
        updateConversations((latest) => {
            const latestConversation = latest.find(({ id }) => id === conversationId);
            if (!latestConversation) return latest;
            const lastMessageAt = messages.at(-1)?.createdAt ?? latestConversation.updatedAt;
            return saveRelationshipAdvisorConversation(latest, {
                ...latestConversation,
                title: buildRelationshipAdvisorConversationTitle(messages, latestConversation.title),
                updatedAt: Math.max(latestConversation.updatedAt, lastMessageAt),
                messages,
            });
        });
    }, [conversationId, state.messages, updateConversations]);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            unsubscribeRef.current?.();
            const activeRequestId = activeRequestIdRef.current;
            if (activeRequestId) {
                cancelledRequestIdsRef.current.add(activeRequestId);
                if (providerStartedRequestIdRef.current === activeRequestId) {
                    relationshipAdvisorClient.cancel(activeRequestId);
                }
            }
        };
    }, []);

    const send = React.useCallback(async (
        text: string,
        images: AttachmentPreview[],
        options?: { retryUserId?: string; imageKeys?: string[] },
    ) => {
        const trimmed = text.trim();
        if (activeRequestIdRef.current || (!trimmed && images.length === 0)) return false;

        const requestId = randomUUID();
        activeRequestIdRef.current = requestId;
        const imageKeys = options?.imageKeys ?? relationshipAdvisorImageKeys(requestId, images);
        const retryIndex = options?.retryUserId ? state.messages.findIndex((message) => message.id === options.retryUserId) : -1;
        const userId = retryIndex >= 0 ? state.messages[retryIndex].id : `user-${requestId}`;
        lastAttemptRef.current = { text: trimmed, images, imageKeys: options?.imageKeys, userId };
        setCanRetry(false);
        const userMessage: RelationshipAdvisorChatMessage = {
            id: `user-${requestId}`,
            role: 'user',
            text: trimmed,
            createdAt: Date.now(),
            imageCount: images.length,
            ...(imageKeys.length ? { imageKeys } : {}),
        };
        const historyMessages = retryIndex >= 0
            ? state.messages.slice(0, retryIndex + 1).slice(-12)
            : [
                ...state.messages.slice(-11),
                userMessage,
            ];
        dispatch({
            type: 'start',
            requestId,
            message: userMessage,
            appendMessage: retryIndex < 0,
            ...(retryIndex >= 0 ? { retryUserId: userId } : {}),
        });

        const imageRefs: string[] = [];
        try {
            if (!options?.imageKeys) await saveRelationshipAdvisorImages(images, imageKeys);
            lastAttemptRef.current = { text: trimmed, images, imageKeys, userId };
            const requestMessages = await uploadRelationshipAdvisorHistory(historyMessages, {
                isCancelled: () => cancelledRequestIdsRef.current.has(requestId),
            });
            if (!requestMessages) {
                if (mountedRef.current && !options?.imageKeys) await deleteAdvisorImages(imageKeys).catch(() => undefined);
                cancelledRequestIdsRef.current.delete(requestId);
                return false;
            }
            imageRefs.push(...requestMessages.flatMap((message) => message.imageRefs ?? []));

            let terminalEventReceived = false;
            const onEvent = (event: RelationshipAdvisorEvent) => {
                if (!mountedRef.current) return;
                dispatch({ type: 'event', event, completedAt: Date.now() });
                if (event.type === 'done' || event.type === 'error') {
                    activeRequestIdRef.current = null;
                    providerStartedRequestIdRef.current = null;
                    cancelledRequestIdsRef.current.delete(requestId);
                    if (event.type === 'error') {
                        setCanRetry(true);
                    } else {
                        lastAttemptRef.current = null;
                        setCanRetry(false);
                    }
                    terminalEventReceived = true;
                    unsubscribeRef.current?.();
                    unsubscribeRef.current = null;
                }
            };
            providerStartedRequestIdRef.current = requestId;
            const unsubscribe = await relationshipAdvisorClient.start({
                requestId,
                messages: requestMessages,
                imageRefs,
            }, onEvent);
            if (terminalEventReceived || !mountedRef.current || cancelledRequestIdsRef.current.has(requestId)) {
                unsubscribe();
            } else {
                unsubscribeRef.current = unsubscribe;
            }
            if (cancelledRequestIdsRef.current.has(requestId)) {
                relationshipAdvisorClient.cancel(requestId);
                return true;
            }
            return true;
        } catch {
            const wasCancelled = cancelledRequestIdsRef.current.has(requestId);
            if (providerStartedRequestIdRef.current === requestId) {
                relationshipAdvisorClient.cancel(requestId);
            }
            await discardRelationshipAdvisorImages(imageRefs).catch(() => undefined);
            if (activeRequestIdRef.current === requestId) activeRequestIdRef.current = null;
            providerStartedRequestIdRef.current = null;
            cancelledRequestIdsRef.current.delete(requestId);
            if (mountedRef.current) {
                dispatch(wasCancelled
                    ? { type: 'cancel-before-start', requestId }
                    : lastAttemptRef.current?.imageKeys
                    ? { type: 'event', event: { type: 'error', requestId, error: 'Relationship advisor is temporarily unavailable' } }
                    : {
                        type: 'fail-before-start',
                        requestId,
                        error: 'Relationship advisor is temporarily unavailable',
                    });
                if (!wasCancelled) setCanRetry(true);
            }
            unsubscribeRef.current?.();
            unsubscribeRef.current = null;
            return false;
        }
    }, [state.messages]);

    const cancel = React.useCallback(() => {
        const requestId = activeRequestIdRef.current;
        if (!requestId) return;
        cancelledRequestIdsRef.current.add(requestId);
        if (providerStartedRequestIdRef.current === requestId) {
            relationshipAdvisorClient.cancel(requestId);
        } else {
            activeRequestIdRef.current = null;
            dispatch({ type: 'cancel-before-start', requestId });
        }
    }, []);

    const clear = React.useCallback(() => {
        if (!state.activeRequestId) {
            lastAttemptRef.current = null;
            setCanRetry(false);
            dispatch({ type: 'reset', messages: [] });
        }
    }, [state.activeRequestId]);

    const retry = React.useCallback(async () => {
        const attempt = lastAttemptRef.current;
        if (!attempt || activeRequestIdRef.current) return false;
        return send(attempt.text, attempt.images, { retryUserId: attempt.userId, imageKeys: attempt.imageKeys });
    }, [send, state.messages]);

    return { ...state, send, cancel, clear, canRetry, retry };
}
