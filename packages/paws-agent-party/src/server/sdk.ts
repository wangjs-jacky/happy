import {
  BrowserCredentialProvider,
  PawsAgentClient,
  startBrowserAccountLink,
  type AgentRequest,
  type ImageAttachmentInput,
  type KeyValueStorage,
  type Machine,
  type MessagePage,
  type MessageSubscription,
  type MessageWatchOptions,
  type SendMessageInput,
  type SendMessageReceipt,
  type Session,
  type SpawnSessionInput,
  type SpawnSessionResult,
} from '@wangjs-jacky/paws-agent/browser';
import type { ConnectionStatus, RoleId } from '../contracts.js';

export interface PawsSdkBoundary {
  status(): ConnectionStatus;
  link(serverUrl: string): Promise<ConnectionStatus>;
  disconnect(): Promise<void>;
  machines(): Promise<Machine[]>;
  spawn(input: SpawnSessionInput & { role: RoleId }): Promise<SpawnSessionResult>;
  watch(sessionId: string, options: MessageWatchOptions): Promise<MessageSubscription>;
  send(input: SendMessageInput): Promise<SendMessageReceipt>;
  historyPage(sessionId: string, options: { afterSeq: number; limit: number; signal?: AbortSignal }): Promise<MessagePage>;
  session(sessionId: string): Promise<Session>;
  requests(sessionId: string): Promise<AgentRequest[]>;
  dispose(): Promise<void>;
}

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();
  get(key: string): Promise<string | null> { return Promise.resolve(this.values.get(key) ?? null); }
  set(key: string, value: string): Promise<void> { this.values.set(key, value); return Promise.resolve(); }
  remove(key: string): Promise<void> { this.values.delete(key); return Promise.resolve(); }
}

export function createRealPawsSdk(): PawsSdkBoundary {
  const storage = new MemoryStorage();
  let state: ConnectionStatus = { state: 'disconnected' };
  let provider: BrowserCredentialProvider | null = null;
  let client: PawsAgentClient | null = null;
  let linkController: AbortController | null = null;
  let generation = 0;

  const readyClient = (): PawsAgentClient => {
    if (!client || state.state !== 'ready') throw new Error('Link a Paws account before starting a consultation.');
    return client;
  };

  const disconnect = async (): Promise<void> => {
    generation += 1;
    const previousController = linkController;
    const previousClient = client;
    const previousProvider = provider;
    linkController = null;
    client = null;
    provider = null;
    state = { state: 'disconnected' };
    previousController?.abort(new DOMException('Account link cancelled', 'AbortError'));
    const cleanup: Promise<void>[] = [];
    if (previousClient) cleanup.push(previousClient.dispose());
    if (previousProvider) cleanup.push(previousProvider.clearCredentials());
    await Promise.allSettled(cleanup);
  };

  return {
    status: () => ({ ...state }),
    async link(rawServerUrl) {
      const serverUrl = normalizeServerUrl(rawServerUrl);
      await disconnect();
      const controller = new AbortController();
      const operation = ++generation;
      linkController = controller;
      const nextProvider = new BrowserCredentialProvider(storage, `paws-agent-party:${serverUrl}`);
      provider = nextProvider;
      const ownsOperation = () => generation === operation && linkController === controller;
      state = { state: 'connecting', serverUrl };
      try {
        const link = await startBrowserAccountLink({ serverUrl, credentials: nextProvider, signal: controller.signal });
        if (!ownsOperation()) return { ...state };
        state = { state: 'linking', serverUrl, qrUrl: link.qrUrl };
        void link.waitForAuthorization({ signal: controller.signal }).then(async () => {
          if (controller.signal.aborted || !ownsOperation()) return;
          state = { state: 'connecting', serverUrl };
          const candidate = new PawsAgentClient({ serverUrl, credentials: nextProvider });
          try {
            await candidate.connect();
            await candidate.machines.list({ active: true });
            if (controller.signal.aborted || !ownsOperation()) return;
            client = candidate;
            linkController = null;
            state = { state: 'ready', serverUrl };
          } finally {
            if (client !== candidate) await candidate.dispose().catch(() => undefined);
          }
        }).catch(async error => {
          if (!ownsOperation() || controller.signal.aborted) return;
          await nextProvider.clearCredentials().catch(() => undefined);
          if (!ownsOperation()) return;
          linkController = null;
          provider = null;
          state = { state: 'error', serverUrl, error: safeError(error) };
        });
        return { ...state };
      } catch (error) {
        if (!ownsOperation()) return { ...state };
        await nextProvider.clearCredentials().catch(() => undefined);
        if (!ownsOperation()) return { ...state };
        linkController = null;
        provider = null;
        state = { state: 'error', serverUrl, error: safeError(error) };
        return { ...state };
      }
    },
    disconnect,
    machines: () => readyClient().machines.list({ active: true }),
    spawn: ({ role: _role, ...input }) => readyClient().sessions.spawn(input),
    watch: (sessionId, options) => readyClient().messages.watch(sessionId, options),
    send: input => readyClient().messages.send(input),
    historyPage: (sessionId, options) => readyClient().messages.historyPage(sessionId, options),
    session: sessionId => readyClient().sessions.get(sessionId),
    async requests(sessionId) {
      const session = await readyClient().sessions.get(sessionId);
      const requests = (session.agentState as { requests?: Record<string, unknown> } | null)?.requests ?? {};
      return Object.entries(requests).map(([id, payload]) => {
        const type = payload && typeof payload === 'object' && 'type' in payload && typeof payload.type === 'string'
          ? payload.type : 'permission';
        return { id, type, payload };
      });
    },
    dispose: disconnect,
  };
}

export type LoadedImage = { name: string; mimeType: string; bytes: Uint8Array } & Pick<ImageAttachmentInput, 'width' | 'height'>;

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Paws operation failed.';
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|secret|key)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 500);
}

function normalizeServerUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('Enter a valid Paws server URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Paws server URL must use HTTP or HTTPS without embedded credentials.');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}
