import * as React from 'react';
import { useArtifacts, useSession, useSessionMessages } from '@/sync/storage';
import { scanSkills } from '@/sync/skills';
import { buildSessionCapabilityHubModel } from './sessionCapabilityHubModel';

export function useSessionCapabilityHub(sessionId: string) {
    const session = useSession(sessionId);
    const { messages } = useSessionMessages(sessionId);
    const artifacts = useArtifacts();
    const machineId = session?.metadata?.machineId ?? null;
    const cwd = session?.metadata?.path ?? undefined;
    const [skillNames, setSkillNames] = React.useState<string[] | null>(null);

    React.useEffect(() => {
        if (!machineId) {
            setSkillNames(null);
            return;
        }

        let cancelled = false;
        setSkillNames(null);
        scanSkills(machineId, { cwd }).then((entries) => {
            if (cancelled) return;
            const names = Array.from(new Set(entries.map((entry) => entry.name).filter(Boolean)))
                .sort((a, b) => a.localeCompare(b));
            setSkillNames(names);
        }).catch(() => {
            if (!cancelled) setSkillNames(null);
        });

        return () => {
            cancelled = true;
        };
    }, [cwd, machineId]);

    return React.useMemo(() => buildSessionCapabilityHubModel({
        session,
        messages,
        artifacts,
        skillNames,
    }), [artifacts, messages, session, skillNames]);
}
