import type { ModeOption } from '@/components/modelModeOptions';
import type { Session } from '@/sync/storageTypes';
import { getLatestSessionModelMetadata } from './newSessionModelMetadata';

/** A choice for one launch, never a device-default binding update. */
export type CodexConnection = { type: 'native' } | { type: 'account'; profileId: string };
export type ConnectionModelOption = ModeOption & { connection: CodexConnection; modelKey: string };
export function sameCodexConnection(a: CodexConnection, b: CodexConnection): boolean {
    return a.type === b.type && (a.type === 'native' || (b.type === 'account' && a.profileId === b.profileId));
}
export function connectionModelKey(connection: CodexConnection, model: string): string {
    return `connection:${JSON.stringify([connection.type, connection.type === 'account' ? connection.profileId : null, model])}`;
}
export function buildConnectionModelOptions(args: {
    machineId: string; sessions: Array<Session | string> | null | undefined;
    profiles: Array<{ id: string; displayName: string; status: string }>;
    currentConnection: CodexConnection; currentModels: ModeOption[]; nativeModels: ModeOption[];
    nativeLabel: string; automaticLabel: string; newSessionLabel?: string;
}): ConnectionModelOption[] {
    const result: ConnectionModelOption[] = [];
    const append = (connection: CodexConnection, label: string, models: ModeOption[]) => {
        const entries = models.filter(model => model.key !== 'default');
        for (const model of entries.length ? entries : [{ key: 'default', name: args.automaticLabel }]) {
            result.push({ ...model, key: connectionModelKey(connection, model.key), modelKey: model.key,
                connection, name: `${model.name} · ${label}`,
                ...(!sameCodexConnection(connection, args.currentConnection) && args.newSessionLabel ? { actionLabel: args.newSessionLabel } : {}),
            });
        }
    };
    const snapshot = (connection: CodexConnection) => getLatestSessionModelMetadata({ sessions: args.sessions,
        selectedMachineId: args.machineId, agent: 'codex',
        codexAccountProfileId: connection.type === 'account' ? connection.profileId : null,
    })?.models?.map(model => ({ key: model.code, name: model.value, description: model.description })) ?? [];
    const label = (connection: CodexConnection) => connection.type === 'native' ? args.nativeLabel
        : `ChatGPT · ${args.profiles.find(profile => profile.id === connection.profileId)?.displayName ?? 'ChatGPT'}`;
    append(args.currentConnection, label(args.currentConnection), args.currentModels);
    if (args.currentConnection.type !== 'native') {
        const models = args.nativeModels.length ? args.nativeModels : snapshot({ type: 'native' });
        // Do not advertise an undiscovered automatic native route as a model.
        if (models.length) append({ type: 'native' }, args.nativeLabel, models);
    }
    for (const profile of args.profiles) {
        const connection: CodexConnection = { type: 'account', profileId: profile.id };
        if (profile.status !== 'available' || sameCodexConnection(connection, args.currentConnection)) continue;
        append(connection, label(connection), snapshot(connection));
    }
    return result;
}
