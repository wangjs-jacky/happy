import { traceStartup, type SessionStartupStage } from './sessionStartupTrace';

export type WebStartupStage = Extract<SessionStartupStage, `web.${string}`>;
export type WebStartupTraceHandle = Readonly<{ traceId: string; startedAt: number }>;

export interface WebStartupTraceRuntime {
    begin(traceId: string, startedAt: number): WebStartupTraceHandle;
    bindSession(handle: WebStartupTraceHandle, sessionId: string): boolean;
    mark(handle: WebStartupTraceHandle, stage: WebStartupStage, now?: number): boolean;
    markSessionStage(
        sessionId: string,
        stage: 'web.processor.ready_received' | 'web.first_agent_event_received' | 'web.turn.completed',
        now?: number,
    ): boolean;
    finish(handle: WebStartupTraceHandle): void;
    cancel(handle: WebStartupTraceHandle, errorCode: string): void;
}

type TraceRecord = {
    readonly handle: WebStartupTraceHandle;
    readonly stages: Set<WebStartupStage>;
    sessionId: string | null;
    timeout: ReturnType<typeof setTimeout> | null;
};

const WEB_STARTUP_STAGES = new Set<WebStartupStage>([
    'web.spawn.clicked',
    'web.session.hydrated',
    'web.first_message.queued',
    'web.session.navigated',
    'web.processor.ready_received',
    'web.first_agent_event_received',
    'web.turn.completed',
]);
const SESSION_TRACE_TIMEOUT_MS = 5 * 60_000;

function now(): number {
    try {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    } catch {
        // Date.now is the safe fallback in restricted web runtimes.
    }
    return Date.now();
}

export function createWebStartupTraceRuntime(
    write: (event: Parameters<typeof traceStartup>[0]) => void = traceStartup,
): WebStartupTraceRuntime {
    const records = new Map<WebStartupTraceHandle, TraceRecord>();
    const sessions = new Map<string, TraceRecord>();

    const remove = (record: TraceRecord) => {
        records.delete(record.handle);
        if (record.sessionId && sessions.get(record.sessionId) === record) sessions.delete(record.sessionId);
        record.sessionId = null;
        if (record.timeout) clearTimeout(record.timeout);
        record.timeout = null;
    };
    const active = (handle: WebStartupTraceHandle): TraceRecord | null => records.get(handle) ?? null;

    const runtime: WebStartupTraceRuntime = {
        begin(traceId, startedAt) {
            const handle = Object.freeze({ traceId, startedAt });
            const record: TraceRecord = { handle, stages: new Set(), sessionId: null, timeout: null };
            records.set(handle, record);
            record.timeout = setTimeout(() => remove(record), SESSION_TRACE_TIMEOUT_MS);
            return handle;
        },
        bindSession(handle, sessionId) {
            const record = active(handle);
            if (!record || typeof sessionId !== 'string' || sessionId.trim().length === 0) return false;
            if (record.sessionId && sessions.get(record.sessionId) === record) sessions.delete(record.sessionId);
            record.sessionId = sessionId;
            sessions.set(sessionId, record);
            return true;
        },
        mark(handle, stage, markedAt = now()) {
            const record = active(handle);
            if (!record || !WEB_STARTUP_STAGES.has(stage) || !Number.isFinite(markedAt) || markedAt < 0) return false;
            if (record.stages.has(stage)) return false;
            record.stages.add(stage);
            try {
                write({
                    traceId: record.handle.traceId,
                    stage,
                    timestamp: markedAt,
                    duration: Math.max(0, markedAt - record.handle.startedAt),
                    outcome: 'success',
                    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
                });
            } catch {
                // Observability must never interrupt the session startup path.
            }
            if (stage === 'web.turn.completed') remove(record);
            return true;
        },
        markSessionStage(sessionId, stage, markedAt) {
            if (typeof sessionId !== 'string' || sessionId.trim().length === 0) return false;
            const record = sessions.get(sessionId);
            return record ? runtime.mark(record.handle, stage, markedAt) : false;
        },
        finish(handle) {
            const record = active(handle);
            if (record) remove(record);
        },
        cancel(handle, errorCode) {
            const record = active(handle);
            if (!record) return;
            if (typeof errorCode === 'string' && errorCode.trim().length > 0) {
                try {
                    write({
                        traceId: record.handle.traceId,
                        stage: 'web.spawn.clicked',
                        timestamp: now(),
                        duration: Math.max(0, now() - record.handle.startedAt),
                        outcome: 'error',
                        errorCode,
                        ...(record.sessionId ? { sessionId: record.sessionId } : {}),
                    });
                } catch {
                    // Best-effort only.
                }
            }
            remove(record);
        },
    };
    return runtime;
}

export const sessionStartupTraceRuntime = createWebStartupTraceRuntime();
