import { logger } from '@/ui/logger';
import { performance } from 'node:perf_hooks';

const SESSION_STARTUP_TRACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StartupTraceWriter = (label: string, event: Record<string, unknown>) => void;

type WorkerStartupStage =
    | 'worker.entry.started'
    | 'worker.auth.ready'
    | 'worker.machine.ready'
    | 'worker.session.created'
    | 'worker.socket.ready'
    | 'worker.processor.starting'
    | 'worker.processor.ready';

const defaultWriter: StartupTraceWriter = (label, event) => logger.debug(label, event);

function runtimeSessionId(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function createWorkerSessionStartupLifecycleFromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): WorkerSessionStartupLifecycle | undefined {
    const traceId = environment.HAPPY_SESSION_STARTUP_TRACE_ID;
    delete environment.HAPPY_SESSION_STARTUP_TRACE_ID;
    if (!traceId || !SESSION_STARTUP_TRACE_ID_RE.test(traceId)) return undefined;
    const lifecycle = new WorkerSessionStartupLifecycle(traceId);
    lifecycle.entryStarted();
    return lifecycle;
}

export async function traceWorkerAuthentication<T extends { machineId: string }>(
    authenticate: () => Promise<T>,
): Promise<T & { startupLifecycle?: WorkerSessionStartupLifecycle }> {
    const startupLifecycle = createWorkerSessionStartupLifecycleFromEnvironment();
    const result = await authenticate();
    startupLifecycle?.authReady();
    startupLifecycle?.machineReady(result.machineId);
    return { ...result, ...(startupLifecycle ? { startupLifecycle } : {}) };
}

export class WorkerSessionStartupLifecycle {
    private readonly traceId: string | undefined;
    private readonly startedAt: number;
    private lastStageAt: number;
    private boundSessionId: string | undefined;
    private socketReadyLogged = false;
    private entryStartedLogged = false;
    private authReadyLogged = false;
    private machineReadyLogged = false;
    private processorStartingLogged = false;
    private processorReadyLogged = false;

    constructor(
        traceId: unknown,
        private readonly write: StartupTraceWriter = defaultWriter,
        private readonly now: () => number = () => performance.now(),
        private readonly wallNow: () => number = Date.now,
    ) {
        this.traceId = typeof traceId === 'string' && SESSION_STARTUP_TRACE_ID_RE.test(traceId)
            ? traceId
            : undefined;
        this.startedAt = this.now();
        this.lastStageAt = this.startedAt;
    }

    entryStarted(): boolean {
        if (!this.traceId || this.entryStartedLogged) return false;
        this.entryStartedLogged = true;
        this.logStage('worker.entry.started');
        return true;
    }

    authReady(): boolean {
        if (!this.traceId || this.authReadyLogged) return false;
        this.authReadyLogged = true;
        this.logStage('worker.auth.ready');
        return true;
    }

    machineReady(machineId?: string): boolean {
        if (!this.traceId || this.machineReadyLogged) return false;
        this.machineReadyLogged = true;
        this.logStage('worker.machine.ready', undefined, machineId);
        return true;
    }

    bindCreatedSession(sessionId: unknown, machineId?: string): boolean {
        const validSessionId = runtimeSessionId(sessionId);
        if (!this.traceId || !validSessionId) return false;
        if (this.boundSessionId) return this.boundSessionId === validSessionId;

        this.boundSessionId = validSessionId;
        this.logStage('worker.session.created', validSessionId, machineId);
        return true;
    }

    socketReady(sessionId: unknown, machineId?: string): boolean {
        const validSessionId = runtimeSessionId(sessionId);
        if (
            !this.traceId
            || !validSessionId
            || validSessionId !== this.boundSessionId
            || this.socketReadyLogged
        ) return false;

        this.socketReadyLogged = true;
        this.logStage('worker.socket.ready', validSessionId, machineId);
        return true;
    }

    processorStarting(sessionId: unknown, machineId?: string): boolean {
        const validSessionId = runtimeSessionId(sessionId);
        if (
            !this.traceId
            || !validSessionId
            || !this.boundSessionId
            || validSessionId !== this.boundSessionId
            || this.processorStartingLogged
        ) return false;
        this.processorStartingLogged = true;
        this.logStage('worker.processor.starting', validSessionId, machineId);
        return true;
    }

    processorReady(sessionId: unknown, machineId?: string): boolean {
        const validSessionId = runtimeSessionId(sessionId);
        if (
            !this.traceId
            || !validSessionId
            || !this.boundSessionId
            || validSessionId !== this.boundSessionId
            || !this.processorStartingLogged
            || this.processorReadyLogged
        ) return false;
        this.processorReadyLogged = true;
        this.logStage('worker.processor.ready', validSessionId, machineId);
        return true;
    }

    private logStage(stage: WorkerStartupStage, sessionId?: string, machineId?: string): void {
        if (!this.traceId) return;
        const currentStageAt = this.now();
        const previousStageAt = this.lastStageAt;
        this.lastStageAt = currentStageAt;
        this.log({
            traceId: this.traceId,
            stage,
            timestamp: this.wallNow(),
            duration: currentStageAt - this.startedAt,
            spanDuration: currentStageAt - previousStageAt,
            outcome: 'success',
            ...(sessionId ? { sessionId } : {}),
            ...(machineId ? { machineId } : {}),
        });
    }

    private log(event: Record<string, unknown>): void {
        try {
            this.write('[SESSION STARTUP]', event);
        } catch {
            // Startup telemetry is best-effort and must never affect worker control flow.
        }
    }
}
