import { PawsAgentError } from './errors';
import { PawsAgentEvents } from './events';
import type {
    AgentRequest,
    MachinesResource,
    MessagesResource,
    PawsAgentClientOptions,
    PawsAgentEventListener,
    RequestsResource,
    SessionsResource,
} from './types';
import { decodeBase64, decrypt } from '../crypto/encryption';
import { RecordEncryptionStore } from '../crypto/records';
import { MachinesResourceImpl } from '../resources/machines';
import { MessagesResourceImpl } from '../resources/messages';
import { RequestsResourceImpl } from '../resources/requests';
import { SessionsResourceImpl } from '../resources/sessions';
import { PawsHttpTransport } from '../transport/http';
import { PawsRealtimeTransport } from '../transport/realtime';

type ClientDependencies = {
    http?: PawsHttpTransport;
    realtime?: PawsRealtimeTransport;
};

export class PawsAgentClient {
    readonly machines: MachinesResource;
    readonly sessions: SessionsResource;
    readonly messages: MessagesResource;
    readonly requests: RequestsResource;

    private readonly events: PawsAgentEvents;
    private readonly encryption = new RecordEncryptionStore();
    private readonly realtime: PawsRealtimeTransport;
    private readonly sessionsImpl: SessionsResourceImpl;
    private disposed = false;

    constructor(options: PawsAgentClientOptions, dependencies: ClientDependencies = {}) {
        this.events = new PawsAgentEvents(options.logger);
        const http = dependencies.http ?? new PawsHttpTransport(options);
        const machines = new MachinesResourceImpl(http, this.encryption);
        let sessions!: SessionsResourceImpl;
        this.realtime = dependencies.realtime ?? new PawsRealtimeTransport({
            serverUrl: options.serverUrl,
            credentials: options.credentials,
            encryption: this.encryption,
            events: this.events,
            logger: options.logger,
            reconnect: options.reconnect,
            resync: async () => {
                await Promise.all([machines.list(), sessions.list()]);
            },
            onUpdate: update => { void this.handleUpdate(update); },
        });
        sessions = new SessionsResourceImpl(
            http,
            this.realtime,
            this.encryption,
            () => machines.list(),
        );
        this.sessionsImpl = sessions;
        this.machines = machines;
        this.sessions = sessions;
        this.messages = new MessagesResourceImpl(http, sessions, this.encryption);
        this.requests = new RequestsResourceImpl(this.realtime, sessions);
    }

    subscribe(listener: PawsAgentEventListener): () => void {
        if (this.disposed) {
            throw new PawsAgentError('CONNECTION_LOST', 'Client has been disposed');
        }
        return this.events.subscribe(listener);
    }

    connect(): Promise<void> {
        return this.realtime.connect();
    }

    disconnect(): Promise<void> {
        return this.realtime.disconnect();
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        await this.realtime.dispose();
        this.encryption.clear();
        this.events.clear();
    }

    private async handleUpdate(update: unknown): Promise<void> {
        if (this.disposed || update == null || typeof update !== 'object') return;
        try {
            const body = (update as { body?: any }).body;
            if (!body || typeof body !== 'object') return;

            if (body.t === 'new-message' && body.message?.content?.t === 'encrypted') {
                const sessionId = body.sid;
                if (typeof sessionId !== 'string') return;
                let encryption = this.encryption.getSession(sessionId);
                if (!encryption) {
                    await this.sessionsImpl.get(sessionId);
                    encryption = this.encryption.getSession(sessionId);
                }
                if (!encryption) throw new PawsAgentError('DECRYPTION_FAILED', 'Session encryption is unavailable');
                const raw = body.message;
                this.events.emit({
                    type: 'message',
                    sessionId,
                    message: {
                        id: raw.id,
                        seq: raw.seq,
                        content: decrypt(encryption.key, encryption.variant, decodeBase64(raw.content.c)),
                        localId: raw.localId ?? null,
                        createdAt: raw.createdAt,
                        updatedAt: raw.updatedAt,
                    },
                });
                return;
            }

            if (body.t === 'update-session' || body.t === 'new-session') {
                const sessions = await this.sessionsImpl.list();
                const sessionId = body.id ?? body.sid ?? body.session?.id;
                const session = sessions.find(candidate => candidate.id === sessionId);
                if (!session) return;
                this.events.emit({ type: 'session', session });
                const state = session.agentState as { requests?: Record<string, unknown> } | null;
                for (const [id, payload] of Object.entries(state?.requests ?? {})) {
                    const value = payload as { type?: unknown; tool?: unknown } | null;
                    const request: AgentRequest = {
                        id,
                        type: typeof value?.type === 'string'
                            ? value.type
                            : typeof value?.tool === 'string' ? value.tool : 'permission',
                        payload,
                    };
                    this.events.emit({ type: 'request', sessionId: session.id, request });
                }
            } else if (body.t === 'update-machine' || body.t === 'new-machine') {
                await this.machines.list();
            }
        } catch (cause) {
            const error = cause instanceof PawsAgentError
                ? cause
                : new PawsAgentError('UNKNOWN', 'Realtime update failed', { cause });
            this.events.emit({ type: 'error', error });
        }
    }
}
