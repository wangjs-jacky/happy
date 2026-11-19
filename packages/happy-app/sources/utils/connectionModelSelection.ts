import type { CodexConnection, ConnectionModelOption } from './modelConnections';
import { sameCodexConnection } from './modelConnections';

type SpawnInput = { machineId: string; directory: string; agent: 'codex'; approvedNewDirectoryCreation: false;
    codexConnection: CodexConnection; model?: string };
/** No source mutation, history forwarding, binding update, or implicit retries. */
export function createConnectionModelSelection(deps: {
    currentConnection: CodexConnection; machineId: string; directory: string;
    isCurrent(): boolean; sameConnection(model: string): void;
    spawn(input: SpawnInput): Promise<{ type: string; sessionId?: string; errorMessage?: string }>;
    hydrate(id: string): Promise<boolean>; configure(id: string, model: string): void; navigate(id: string): void;
}) {
    let pending = false;
    return async (option: ConnectionModelOption): Promise<void> => {
        if (pending || !deps.isCurrent()) return;
        if (sameCodexConnection(deps.currentConnection, option.connection)) {
            deps.sameConnection(option.modelKey);
            return;
        }
        pending = true;
        try {
            const result = await deps.spawn({ machineId: deps.machineId, directory: deps.directory, agent: 'codex',
                approvedNewDirectoryCreation: false, codexConnection: option.connection,
                ...(option.modelKey !== 'default' ? { model: option.modelKey } : {}) });
            if (!deps.isCurrent()) return;
            if (result.type !== 'success' || !result.sessionId) throw new Error(result.errorMessage || 'session-start-failed');
            if (!await deps.hydrate(result.sessionId)) throw new Error('session-hydration-failed');
            if (!deps.isCurrent()) return;
            deps.configure(result.sessionId, option.modelKey);
            deps.navigate(result.sessionId);
        } finally { pending = false; }
    };
}
