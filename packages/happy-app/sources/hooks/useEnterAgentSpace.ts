import * as React from 'react';
import type { AgentLauncher } from '@/components/agents/launchAgent';
import { resolveAgentLaunchConfig } from '@/components/agents/resolveAgentLaunchConfig';
import { Modal } from '@/modal';
import { t } from '@/text';
import { storage, useAllMachines, useLocalSettingMutable, useSetting } from '@/sync/storage';
import { isMachineOnline } from '@/utils/machineUtils';
import { useNavigateToSession } from './useNavigateToSession';
import { useNewSessionDraft } from './useNewSessionDraft';
import { useSpawnSession, type SpawnSessionCoreResult } from './useSpawnSession';

export type EnterAgentSpaceResult = SpawnSessionCoreResult | { type: 'busy' };

export type EnterAgentSpaceOptions = {
    initialDraft?: string;
    beforeNavigate?: () => void;
};

/**
 * Creates the blank session that anchors an Agent space, then commits the local
 * space selection immediately before navigating to that session.
 */
export function useEnterAgentSpace(): {
    entering: boolean;
    enter: (agent: AgentLauncher, options?: EnterAgentSpaceOptions) => Promise<EnterAgentSpaceResult>;
} {
    const machines = useAllMachines({ includeOffline: true });
    const draft = useNewSessionDraft();
    const defaults = useSetting('agentDefaultOverrides');
    const [agentSpaceId, setAgentSpaceId] = useLocalSettingMutable('agentSpaceId');
    const { spawnSession } = useSpawnSession();
    const navigateToSession = useNavigateToSession();
    const [entering, setEntering] = React.useState(false);
    const enteringRef = React.useRef(false);

    const enter = React.useCallback(async (
        agent: AgentLauncher,
        options?: EnterAgentSpaceOptions,
    ): Promise<EnterAgentSpaceResult> => {
        if (enteringRef.current) {
            return { type: 'busy' };
        }

        enteringRef.current = true;
        setEntering(true);
        try {
            const machine = machines.find((candidate) => candidate.id === agent.machineId);
            if (!machine || !isMachineOnline(machine)) {
                const message = t('newSession.machineOffline');
                Modal.alert(t('common.error'), message);
                return { type: 'error', message };
            }

            const config = resolveAgentLaunchConfig({ agent, draft, defaults });
            if (config.type === 'error') {
                Modal.alert(t('common.error'), t('agentSpace.enterFailed'));
                return config;
            }

            const result = await spawnSession({
                machineId: machine.id,
                machine,
                path: agent.path,
                agent: config.agent,
                worktreeKey: null,
                permissionMode: config.permissionMode,
                modelMode: config.modelMode,
                effortLevel: config.effortLevel,
                prompt: '',
            });
            if (result.type !== 'success') {
                return result;
            }

            try {
                if (options?.initialDraft !== undefined) {
                    storage.getState().updateSessionDraft(result.sessionId, options.initialDraft);
                }
                options?.beforeNavigate?.();

                const previousAgentSpaceId = agentSpaceId;
                setAgentSpaceId(agent.id);
                try {
                    navigateToSession(result.sessionId);
                } catch (error) {
                    setAgentSpaceId(previousAgentSpaceId);
                    throw error;
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : t('agentSpace.enterFailed');
                Modal.alert(t('common.error'), t('agentSpace.enterFailed'));
                return { type: 'error', message };
            }

            return result;
        } finally {
            enteringRef.current = false;
            setEntering(false);
        }
    }, [agentSpaceId, defaults, draft, machines, navigateToSession, setAgentSpaceId, spawnSession]);

    return { entering, enter };
}
