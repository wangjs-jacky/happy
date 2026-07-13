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
    const mountedRef = React.useRef(true);
    const operationTokenRef = React.useRef(0);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            operationTokenRef.current += 1;
            enteringRef.current = false;
        };
    }, []);

    const enter = React.useCallback(async (
        agent: AgentLauncher,
        options?: EnterAgentSpaceOptions,
    ): Promise<EnterAgentSpaceResult> => {
        if (enteringRef.current) {
            return { type: 'busy' };
        }

        enteringRef.current = true;
        const operationToken = ++operationTokenRef.current;
        const isCurrentOperation = () => (
            mountedRef.current && operationTokenRef.current === operationToken
        );
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
            if (!isCurrentOperation()) {
                return { type: 'cancelled' };
            }
            if (result.type !== 'success') {
                return result;
            }

            try {
                if (options?.initialDraft !== undefined) {
                    storage.getState().updateSessionDraft(result.sessionId, options.initialDraft);
                }
                if (!isCurrentOperation()) {
                    return { type: 'cancelled' };
                }
                options?.beforeNavigate?.();
                if (!isCurrentOperation()) {
                    return { type: 'cancelled' };
                }

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
            if (operationTokenRef.current === operationToken) {
                enteringRef.current = false;
                if (mountedRef.current) setEntering(false);
            }
        }
    }, [agentSpaceId, defaults, draft, machines, navigateToSession, setAgentSpaceId, spawnSession]);

    return { entering, enter };
}
