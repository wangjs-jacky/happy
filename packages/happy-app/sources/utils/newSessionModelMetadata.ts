import type { Metadata, Session } from '@/sync/storageTypes';

export function getLatestSessionModelMetadata(args: {
    sessions: Array<Session | string> | null | undefined;
    selectedMachineId: string | null | undefined;
    agent: string | null | undefined;
}): Metadata | null {
    const { sessions, selectedMachineId, agent } = args;
    let latest: Session | null = null;
    let latestCatalogTime = -Infinity;

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

        // Codex captures its catalog on connection, including resume-in-place.
        // Heartbeats and config edits must not make an old snapshot look newer.
        // Older CLIs lack capture time, so use immutable creation time for them.
        // Other agents can publish live model updates; retain their existing policy.
        const catalogTime = metadata.flavor === 'codex'
            ? metadata.modelsUpdatedAt ?? entry.createdAt
            : entry.activeAt;
        if (
            !latest
            || catalogTime > latestCatalogTime
            || (catalogTime === latestCatalogTime && entry.id > latest.id)
        ) {
            latest = entry;
            latestCatalogTime = catalogTime;
        }
    }

    return latest?.metadata ?? null;
}
