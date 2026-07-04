import * as React from 'react';
import { useArtifacts, useSession, useSessionMessages } from '@/sync/storage';
import { buildSessionCapabilityHubModel } from './sessionCapabilityHubModel';

export function useSessionCapabilityHub(sessionId: string) {
    const session = useSession(sessionId);
    const { messages } = useSessionMessages(sessionId);
    const artifacts = useArtifacts();

    return React.useMemo(() => buildSessionCapabilityHubModel({
        session,
        messages,
        artifacts,
    }), [artifacts, messages, session]);
}
