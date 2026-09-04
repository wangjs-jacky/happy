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

type UnsafeSessionStartupTraceEvent = SessionStartupTraceEvent & Record<string, unknown>;

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
): SessionStartupTraceEvent {
    const sanitized: Record<string, unknown> = {};
    for (const key of SESSION_STARTUP_TRACE_KEYS) {
        if (event[key] !== undefined) {
            sanitized[key] = event[key];
        }
    }
    return sanitized as unknown as SessionStartupTraceEvent;
}

export function serializeSessionStartupTrace(event: UnsafeSessionStartupTraceEvent): string {
    return JSON.stringify(sanitizeSessionStartupTrace(event));
}

export function traceStartup(event: UnsafeSessionStartupTraceEvent): void {
    console.info(serializeSessionStartupTrace(event));
}
