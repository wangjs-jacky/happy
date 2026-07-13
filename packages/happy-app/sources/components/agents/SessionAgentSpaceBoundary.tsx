import * as React from 'react';
import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@/text';
import { SessionCapabilityHub } from '@/components/rightPanel/SessionCapabilityHub';
import { AgentSpaceCompanionPanel } from './AgentSpaceCompanionPanel';
import { buildAgentSpaceCompanionModel } from './agentSpaceCompanionModel';
import { insertSessionQuickPrompt, resolveSessionRightPanel } from './agentSpacePanelRouting';
import type { AgentLauncher } from './launchAgent';

export type SessionPromptComposerHandle = {
    setMessage: (prompt: string) => void;
};

export const SessionRightPanelContent = React.memo(function SessionRightPanelContent({
    composerHandleRef,
    sessionId,
    spaceAgent,
}: {
    composerHandleRef: React.RefObject<SessionPromptComposerHandle | null>;
    sessionId: string;
    spaceAgent: AgentLauncher | null;
}) {
    const selection = resolveSessionRightPanel({ spaceAgent });
    const handleInsertPrompt = React.useCallback((prompt: string) => {
        insertSessionQuickPrompt(composerHandleRef.current, prompt);
    }, [composerHandleRef]);

    if (selection.type === 'companion') {
        return (
            <AgentSpaceCompanionPanel
                agent={selection.agent}
                model={buildAgentSpaceCompanionModel(selection.agent)}
                onInsertPrompt={handleInsertPrompt}
            />
        );
    }

    return <SessionCapabilityHub onInsertQuickPrompt={handleInsertPrompt} sessionId={sessionId} />;
});

export const AgentSpaceExitButton = React.memo(function AgentSpaceExitButton({
    color,
    onPress,
}: {
    color: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityLabel={t('agentSpace.exit')}
            accessibilityRole="button"
            hitSlop={12}
            onPress={onPress}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 4 }}
        >
            <Ionicons name="exit-outline" size={20} color={color} />
            <Text style={{ color, fontSize: 13, fontWeight: '600' }}>{t('agentSpace.exit')}</Text>
        </Pressable>
    );
});
