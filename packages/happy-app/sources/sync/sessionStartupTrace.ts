export type SessionStartupStage =
    | 'web.spawn.clicked'
    | 'server.rpc.received'
    | 'server.rpc.daemon_found'
    | 'daemon.spawn.child_started'
    | 'worker.session.created'
    | 'daemon.spawn.webhook_received'
    | 'worker.socket.ready'
    | 'web.session.hydrated'
    | 'web.first_message.queued'
    | 'web.session.navigated';

export type SessionStartupOutcome = 'success' | 'error';

export interface SessionStartupTraceEvent {
    traceId: string;
    stage: SessionStartupStage;
    timestamp?: number;
    duration?: number;
    outcome?: SessionStartupOutcome;
    sessionId?: string;
    machineId?: string;
    errorCode?: string;
}

type UnsafeSessionStartupTraceEvent = unknown;

const SESSION_STARTUP_TRACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_STARTUP_STAGES = new Set<SessionStartupStage>([
    'web.spawn.clicked',
    'server.rpc.received',
    'server.rpc.daemon_found',
    'daemon.spawn.child_started',
    'worker.session.created',
    'daemon.spawn.webhook_received',
    'worker.socket.ready',
    'web.session.hydrated',
    'web.first_message.queued',
    'web.session.navigated',
]);

const SESSION_STARTUP_TRACE_KEYS = [
    'traceId',
    'stage',
    'timestamp',
    'duration',
    'outcome',
    'sessionId',
    'machineId',
    'errorCode',
] as const satisfies readonly (keyof SessionStartupTraceEvent)[];

export function sanitizeSessionStartupTrace(
    event: UnsafeSessionStartupTraceEvent,
): SessionStartupTraceEvent | null {
    try {
        if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
        const candidate = event as Record<string, unknown>;
        if (typeof candidate.traceId !== 'string' || !SESSION_STARTUP_TRACE_ID_RE.test(candidate.traceId)) return null;
        if (typeof candidate.stage !== 'string' || !SESSION_STARTUP_STAGES.has(candidate.stage as SessionStartupStage)) return null;
        if (candidate.outcome !== undefined && candidate.outcome !== 'success' && candidate.outcome !== 'error') return null;
        for (const key of ['timestamp', 'duration'] as const) {
            const value = candidate[key];
            if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return null;
        }
        for (const key of ['sessionId', 'machineId', 'errorCode'] as const) {
            const value = candidate[key];
            if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) return null;
        }

        const sanitized: Record<string, unknown> = {};
        for (const key of SESSION_STARTUP_TRACE_KEYS) {
            if (candidate[key] !== undefined) {
                sanitized[key] = candidate[key];
            }
        }
        return sanitized as unknown as SessionStartupTraceEvent;
    } catch {
        return null;
    }
}

export function serializeSessionStartupTrace(event: UnsafeSessionStartupTraceEvent): string | null {
    try {
        const sanitized = sanitizeSessionStartupTrace(event);
        return sanitized ? JSON.stringify(sanitized) : null;
    } catch {
        return null;
    }
}

export function traceStartup(event: UnsafeSessionStartupTraceEvent): void {
    try {
        const serialized = serializeSessionStartupTrace(event);
        if (serialized) console.info(serialized);
    } catch {
        // Startup observability is best-effort and must never affect session creation.
    }
}
