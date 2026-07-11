import type { Metadata, Session } from '@/sync/storageTypes';

export function getLatestSessionModelMetadata(args: {
    sessions: Array<Session | string> | null | undefined;
    selectedMachineId: string | null | undefined;
    agent: string | null | undefined;
}): Metadata | null {
    const { sessions, selectedMachineId, agent } = args;
    let latest: Session | null = null;

    for (const entry of sessions ?? []) {
        if (typeof entry === 'string') {
            continue;
        }

        const metadata = entry.metadata;
        if (!metadata?.models?.length) {
            continue;
        }
        if (selectedMachineId && metadata.machineId !== selectedMachineId) {
            continue;
        }
        if (agent && metadata.flavor !== agent) {
            continue;
        }

        if (!latest || entry.activeAt > latest.activeAt) {
            latest = entry;
        }
    }

    return latest?.metadata ?? null;
}
