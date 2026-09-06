import {
    relationshipAdvisorChatReducer as pluginReducer,
    type RelationshipAdvisorChatMessage as PluginMessage,
    type RelationshipAdvisorChatState as PluginState,
    type RelationshipAdvisorChatAction as PluginAction,
} from '@paws/plugins/relationship-advisor/chat';

export interface RelationshipAdvisorChatMessage extends PluginMessage {
    /** Device-local image cache keys; never persist short-lived provider URLs. */
    imageKeys?: string[];
}
export interface RelationshipAdvisorChatState extends PluginState {
    messages: RelationshipAdvisorChatMessage[];
}
export type RelationshipAdvisorChatAction = PluginAction | (Extract<PluginAction, { type: 'start' }> & { retryUserId: string });

export function relationshipAdvisorChatReducer(state: RelationshipAdvisorChatState, action: RelationshipAdvisorChatAction): RelationshipAdvisorChatState {
    if (action.type === 'start' && 'retryUserId' in action) {
        const index = state.messages.findIndex((message) => message.id === action.retryUserId && message.role === 'user');
        if (index >= 0) return pluginReducer({ ...state, messages: state.messages.slice(0, index + 1) }, { ...action, appendMessage: false });
    }
    return pluginReducer(state, action);
}

export {
    shouldShowRelationshipAdvisorEmptyState,
    type RelationshipAdvisorEvent,
} from '@paws/plugins/relationship-advisor/chat';
