export interface AgentSpaceIdentity {
    id: string;
    machineId: string;
    path: string;
}

export interface AgentSpaceSessionIdentity {
    active: boolean;
    createdAt: number;
    metadata: {
        machineId?: string | null;
        path?: string | null;
    } | null;
}

function isRootPath(path: string): boolean {
    if (path === '/' || path === '//' || /^[a-z]:\/$/i.test(path)) {
        return true;
    }
    if (!path.startsWith('//') || !path.endsWith('/')) {
        return false;
    }
    const uncParts = path.slice(2, -1).split('/').filter(Boolean);
    return uncParts.length <= 2;
}

function isUncShareRoot(path: string): boolean {
    return path.startsWith('//')
        && path.slice(2).split('/').filter(Boolean).length === 2;
}

/**
 * Produces the stable path identity shared by saved Agents and live sessions.
 * Windows drive and UNC identities are case-insensitive; POSIX identities retain case.
 */
export function canonicalizeAgentPath(path: string | null | undefined, homeDir?: string | null): string | null {
    if (!path) {
        return null;
    }

    let normalized = path.replace(/\\/g, '/');
    if (normalized === '~' || normalized.startsWith('~/')) {
        if (!homeDir) {
            return null;
        }
        const normalizedHome = homeDir.replace(/\\/g, '/');
        normalized = normalized === '~'
            ? normalizedHome
            : `${normalizedHome.replace(/\/+$/, '')}/${normalized.slice(2)}`;
    }

    const isUnc = normalized.startsWith('//');
    normalized = isUnc
        ? `//${normalized.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`
        : normalized.replace(/\/{2,}/g, '/');

    if (isUncShareRoot(normalized)) {
        normalized = `${normalized.replace(/\/+$/, '')}/`;
    } else if (!isRootPath(normalized)) {
        normalized = normalized.replace(/\/+$/, '');
    }

    const isWindowsDrive = /^[a-z]:($|\/)/i.test(normalized);
    return isUnc || isWindowsDrive ? normalized.toLowerCase() : normalized;
}

export function matchAgentForSession<T extends AgentSpaceIdentity>(args: {
    agents: readonly T[];
    agentSpaceId: string | null;
    machineId: string | null | undefined;
    sessionPath: string | null | undefined;
    homeDir: string | null | undefined;
}): T | null {
    if (!args.machineId) {
        return null;
    }
    const canonicalSessionPath = canonicalizeAgentPath(args.sessionPath, args.homeDir);
    if (!canonicalSessionPath) {
        return null;
    }

    const candidates = args.agents.filter((agent) => (
        agent.machineId === args.machineId
        && canonicalizeAgentPath(agent.path, args.homeDir) === canonicalSessionPath
    ));
    const currentAgent = args.agentSpaceId
        ? candidates.find((agent) => agent.id === args.agentSpaceId)
        : undefined;
    if (currentAgent) {
        return currentAgent;
    }
    return candidates.length === 1 ? candidates[0]! : null;
}

export function hasDuplicateAgentPath<T extends AgentSpaceIdentity>(args: {
    agents: readonly T[];
    editingId: string | null;
    machineId: string;
    path: string;
    homeDir: string | null | undefined;
}): boolean {
    const canonicalPath = canonicalizeAgentPath(args.path, args.homeDir);
    if (!canonicalPath) {
        return false;
    }
    return args.agents.some((agent) => (
        agent.id !== args.editingId
        && agent.machineId === args.machineId
        && canonicalizeAgentPath(agent.path, args.homeDir) === canonicalPath
    ));
}

export function selectAgentSpaceSessions<T extends AgentSpaceSessionIdentity>(args: {
    sessions: readonly T[];
    machineId: string;
    agentPath: string;
    homeDir: string | null | undefined;
}): T[] {
    const canonicalAgentPath = canonicalizeAgentPath(args.agentPath, args.homeDir);
    if (!canonicalAgentPath) {
        return [];
    }
    return args.sessions
        .filter((session) => (
            session.metadata?.machineId === args.machineId
            && canonicalizeAgentPath(session.metadata.path, args.homeDir) === canonicalAgentPath
        ))
        .sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt - a.createdAt);
}
