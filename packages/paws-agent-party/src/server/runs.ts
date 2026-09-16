import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MessageSubscription, SendMessageInput } from '@wangjs-jacky/paws-agent';
import {
  ROLE_IDS,
  type AgentMessagesResponse,
  type FollowUpInput,
  type ImageRef,
  type RoleId,
  type RoleSnapshot,
  type RunSnapshot,
  type StartInput,
} from '../contracts.js';
import { AssetStore } from './assets.js';
import { rolePrompt } from './market.js';
import type { DecodedPartyMessage, PartyBus } from './party.js';
import { DurableTurnDecoder, type TurnTerminal } from './protocol.js';
import { safeError, type PawsSdkBoundary } from './sdk.js';

type StoredRun = { snapshot: RunSnapshot; input: StartInput; cursors: Partial<Record<RoleId, number>> };
type RunsFile = { runs: StoredRun[]; requestIds: Record<string, string>; followupIds?: string[] };

export class RunError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class RunService {
  private readonly runs = new Map<string, StoredRun>();
  private readonly requestIds = new Map<string, string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly followupControllers = new Set<AbortController>();
  private readonly followupIds = new Set<string>();
  private readonly startInFlight = new Map<string, Promise<RunSnapshot>>();
  private readonly followupInFlight = new Map<string, Promise<void>>();
  private readonly roleQueues = new Map<string, Promise<void>>();
  private persistQueue: Promise<void> = Promise.resolve();
  private closing = false;

  private constructor(
    private readonly path: string,
    private readonly sdk: PawsSdkBoundary,
    private readonly assets: AssetStore,
    private readonly party: PartyBus,
    private readonly turnTimeoutMs: number,
    file: RunsFile,
  ) {
    for (const run of file.runs) {
      if (run.snapshot.status === 'running') {
        run.snapshot.status = 'interrupted';
        run.snapshot.phase = 'interrupted-after-restart';
        run.snapshot.error = 'Service restarted during this run; it was not replayed.';
      }
      this.runs.set(run.snapshot.id, run);
    }
    for (const [requestId, id] of Object.entries(file.requestIds)) this.requestIds.set(requestId, id);
    for (const id of file.followupIds ?? []) this.followupIds.add(id);
  }

  static async create(options: {
    dataDir: string;
    sdk: PawsSdkBoundary;
    assets: AssetStore;
    party: PartyBus;
    turnTimeoutMs?: number;
  }): Promise<RunService> {
    const path = join(options.dataDir, 'runs.json');
    let file: RunsFile = { runs: [], requestIds: {} };
    try { file = JSON.parse(await readFile(path, 'utf8')) as RunsFile; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const service = new RunService(path, options.sdk, options.assets, options.party, options.turnTimeoutMs ?? 10 * 60_000, file);
    await service.persist();
    return service;
  }

  list(): RunSnapshot[] {
    return [...this.runs.values()].map(run => clone(run.snapshot)).sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): RunSnapshot { return clone(this.requireRun(id).snapshot); }
  hasActiveRun(): boolean { return [...this.runs.values()].some(run => run.snapshot.status === 'running'); }

  async start(input: StartInput): Promise<RunSnapshot> {
    validateStartInput(input);
    const existingId = this.requestIds.get(input.requestId);
    if (existingId) return this.get(existingId);
    const existingStart = this.startInFlight.get(input.requestId);
    if (existingStart) return clone(await existingStart);
    const pending = this.startNew(input);
    this.startInFlight.set(input.requestId, pending);
    try { return clone(await pending); }
    finally { if (this.startInFlight.get(input.requestId) === pending) this.startInFlight.delete(input.requestId); }
  }

  private async startNew(input: StartInput): Promise<RunSnapshot> {
    if (this.sdk.status().state !== 'ready') throw new RunError(409, 'Link a Paws account before starting a consultation.');
    await this.assets.resolveMany(input.images);
    const partyId = await this.party.create(`Synthetic consultation: ${input.stock}`);
    const roles = Object.fromEntries(ROLE_IDS.map(role => [role, {
      role,
      status: input.mode === 'single' && role !== 'moderator' ? 'not-selected' : 'pending',
    } satisfies RoleSnapshot])) as Record<RoleId, RoleSnapshot>;
    const snapshot: RunSnapshot = {
      id: randomUUID(), partyId, stock: input.stock, mode: input.mode,
      status: 'running', phase: 'queued', createdAt: Date.now(), roles,
    };
    const stored: StoredRun = { snapshot, input: clone(input), cursors: {} };
    this.runs.set(snapshot.id, stored);
    this.requestIds.set(input.requestId, snapshot.id);
    const controller = new AbortController();
    this.controllers.set(snapshot.id, controller);
    await this.persist();
    void this.execute(stored, controller).catch(() => undefined);
    return clone(snapshot);
  }

  async stop(id: string): Promise<RunSnapshot> {
    const run = this.requireRun(id);
    if (run.snapshot.status === 'running') {
      run.snapshot.status = 'stopped';
      run.snapshot.phase = 'coordination-stopped';
      run.snapshot.error = 'Coordination stopped. Already accepted remote work may continue.';
      this.controllers.get(id)?.abort(new DOMException('Coordination stopped', 'AbortError'));
      await this.persist();
    }
    return clone(run.snapshot);
  }

  async agentMessages(id: string, role: RoleId, afterSeq: number): Promise<AgentMessagesResponse> {
    const run = this.requireRun(id);
    const sessionId = run.snapshot.roles[role].sessionId;
    if (!sessionId) return { messages: [], hasMore: false, requests: [], status: run.snapshot.roles[role].status };
    const [page, requests] = await Promise.all([
      this.sdk.historyPage(sessionId, { afterSeq, limit: 200 }),
      this.sdk.requests(sessionId),
    ]);
    return { sessionId, messages: page.messages, hasMore: page.hasMore, requests, status: run.snapshot.roles[role].status };
  }

  async followUp(id: string, input: FollowUpInput): Promise<void> {
    const run = this.requireRun(id);
    if (run.snapshot.status === 'running') throw new RunError(409, 'Follow-ups are accepted only after the initial run is terminal.');
    if (!isRecord(input) || typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 128) {
      throw new RunError(400, 'requestId is required.');
    }
    if (typeof input.text !== 'string' || !Array.isArray(input.images) || !input.images.every(isImageRef)
      || !Array.isArray(input.to) || !input.to.every(role => typeof role === 'string')) {
      throw new RunError(400, 'Malformed follow-up input.');
    }
    if ((!input.text.trim() && input.images.length === 0) || input.text.length > 20_000) {
      throw new RunError(400, 'Provide bounded text, images, or both.');
    }
    const roles = input.to.length === 0 ? ['moderator'] satisfies RoleId[] : [...new Set(input.to)];
    if (roles.some(role => !ROLE_IDS.includes(role))) throw new RunError(400, 'Unknown follow-up recipient.');
    const dedupeKey = `${id}:${input.requestId}`;
    if (this.followupIds.has(dedupeKey)) return;
    const existingFollowUp = this.followupInFlight.get(dedupeKey);
    if (existingFollowUp) return existingFollowUp;
    const pending = this.queueFollowUp(run, input, roles, dedupeKey);
    this.followupInFlight.set(dedupeKey, pending);
    try { await pending; }
    finally { if (this.followupInFlight.get(dedupeKey) === pending) this.followupInFlight.delete(dedupeKey); }
  }

  private async queueFollowUp(run: StoredRun, input: FollowUpInput, roles: RoleId[], dedupeKey: string): Promise<void> {
    await this.assets.resolveMany(input.images);
    this.followupIds.add(dedupeKey);
    await this.persist();
    for (const role of roles) {
      const key = `${run.snapshot.id}:${role}`;
      const previous = this.roleQueues.get(key) ?? Promise.resolve();
      const controller = new AbortController();
      this.followupControllers.add(controller);
      const queued = previous.catch(() => undefined).then(async () => {
        const images = await this.loadImages(input.images);
        await this.taskTurn(run, role, input.text, images, controller.signal);
      }).finally(() => this.followupControllers.delete(controller));
      this.roleQueues.set(key, queued);
      void queued.catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const controller of this.controllers.values()) controller.abort(new DOMException('Service closing', 'AbortError'));
    for (const controller of this.followupControllers) controller.abort(new DOMException('Service closing', 'AbortError'));
    await this.persistQueue.catch(() => undefined);
  }

  private async execute(run: StoredRun, controller: AbortController): Promise<void> {
    try {
      const images = await this.loadImages(run.input.images);
      if (run.input.mode === 'single') {
        await this.phase(run, 'moderator');
        await this.taskTurn(run, 'moderator', run.input.text, images, controller.signal);
      } else {
        await this.phase(run, 'moderator-opening');
        await this.taskTurn(run, 'moderator', `Open the consultation, frame the question, and assign the three specialist perspectives. User request: ${run.input.text}`, images, controller.signal);
        await this.phase(run, 'specialist-analysis');
        await Promise.all((['trend30', 'structure10', 'timing1'] satisfies RoleId[]).map(role =>
          this.taskTurn(run, role, `Initial specialist analysis. User request: ${run.input.text}`, images, controller.signal)));
        await this.phase(run, 'specialist-cross-examination');
        await Promise.all((['trend30', 'structure10', 'timing1'] satisfies RoleId[]).map(role =>
          this.taskTurn(run, role, 'Cross-examine the other specialists using the complete party discussion, then publish one revised conclusion.', images, controller.signal)));
        await this.phase(run, 'moderator-summary');
        await this.taskTurn(run, 'moderator', 'Publish the final synthesis from the complete party history.', images, controller.signal);
      }
      if (run.snapshot.status === 'running') {
        run.snapshot.status = 'completed';
        run.snapshot.phase = 'completed';
        await this.persist();
      }
    } catch (error) {
      if (!controller.signal.aborted) controller.abort(error);
      if (!this.closing && run.snapshot.status === 'running') {
        run.snapshot.status = 'failed';
        run.snapshot.phase = 'failed';
        run.snapshot.error = safeError(error);
        await this.persist();
      }
    } finally {
      this.controllers.delete(run.snapshot.id);
    }
  }

  private async phase(run: StoredRun, phase: string): Promise<void> { run.snapshot.phase = phase; await this.persist(); }

  private async taskTurn(
    run: StoredRun,
    role: RoleId,
    task: string,
    images: SendMessageInput['images'],
    signal: AbortSignal,
  ): Promise<string> {
    throwIfAborted(signal);
    const taskMessage = await this.party.send({ partyId: run.snapshot.partyId, from: 'host', to: [role], text: task, images: run.input.images });
    const history = await this.party.read(run.snapshot.partyId);
    const delivered = history.find(message => message.id === taskMessage.id);
    if (!delivered) throw new Error('Party task delivery was not durably readable.');
    const result = await this.runRemoteTurn(
      run, role, rolePrompt(role, run.input.stock, delivered.text, boundedCompleteContext(history)), images, signal,
    );
    await this.party.send({ partyId: run.snapshot.partyId, from: role, to: '*', text: result, replyTo: taskMessage.id });
    return result;
  }

  private async runRemoteTurn(
    run: StoredRun,
    role: RoleId,
    prompt: string,
    images: SendMessageInput['images'],
    signal: AbortSignal,
  ): Promise<string> {
    const roleState = run.snapshot.roles[role];
    const deadline = deadlineSignal(signal, this.turnTimeoutMs);
    const runSignal = deadline.signal;
    roleState.status = roleState.sessionId ? 'running' : 'spawning';
    await this.persist();
    let subscription: MessageSubscription | undefined;
    try {
      const sessionId = await this.ensureSession(run, role, runSignal);
      const localId = randomUUID();
      const decoder = new DurableTurnDecoder(localId);
      const terminal = deferred<TurnTerminal>();
      terminal.promise.catch(() => undefined);
      const pendingWatch = this.sdk.watch(sessionId, {
        afterSeq: run.cursors[role] ?? 0,
        signal: runSignal,
        onMessage: message => {
          run.cursors[role] = Math.max(run.cursors[role] ?? 0, message.seq);
          const result = decoder.accept(message);
          if (result) terminal.resolve(result);
        },
        onError: error => terminal.reject(error),
      });
      pendingWatch.then(value => { if (runSignal.aborted) value.unsubscribe(); }).catch(() => undefined);
      subscription = await raceAbort(pendingWatch, runSignal);
      roleState.status = 'running';
      await this.persist();
      const send = raceAbort(this.sdk.send({ sessionId, text: prompt, localId, images, signal: runSignal }), runSignal);
      const [, result] = await raceAbort(Promise.all([send, terminal.promise]), runSignal);
      if (result.type === 'failed') throw new Error(`Remote ${role} turn ${result.status}.`);
      roleState.status = 'completed';
      await this.persist();
      return result.text;
    } catch (error) {
      roleState.status = signal.aborted ? 'stopped' : 'failed';
      roleState.error = safeError(error);
      await this.persist();
      throw error;
    } finally {
      subscription?.unsubscribe();
      deadline.dispose();
    }
  }

  private async ensureSession(run: StoredRun, role: RoleId, signal: AbortSignal): Promise<string> {
    const existing = run.snapshot.roles[role].sessionId;
    if (existing) return existing;
    const pending = this.sdk.spawn({
      role, machineId: run.input.machineId, directory: run.input.directory,
      approvedNewDirectoryCreation: false, agent: run.input.agents[role],
    });
    pending.then(async result => {
      if (result.type !== 'success') return;
      run.snapshot.roles[role].sessionId = result.sessionId;
      await this.persist();
    }).catch(() => undefined);
    const result = await raceAbort(pending, signal);
    if (result.type === 'requestToApproveDirectoryCreation') {
      throw new Error(`Directory approval required for ${result.directory}; approve it in Paws before retrying.`);
    }
    if (result.type === 'error') throw new Error(result.errorMessage);
    run.snapshot.roles[role].sessionId = result.sessionId;
    await this.persist();
    return result.sessionId;
  }

  private async loadImages(refs: ImageRef[]): Promise<SendMessageInput['images']> {
    return (await this.assets.resolveMany(refs)).map(({ ref, bytes }) => ({ name: ref.name, mimeType: ref.mimeType, bytes }));
  }

  private requireRun(id: string): StoredRun {
    const run = this.runs.get(id);
    if (!run) throw new RunError(404, 'Consultation not found.');
    return run;
  }

  private persist(): Promise<void> {
    const file: RunsFile = {
      runs: [...this.runs.values()], requestIds: Object.fromEntries(this.requestIds), followupIds: [...this.followupIds],
    };
    this.persistQueue = this.persistQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(file), { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.path);
      await chmod(this.path, 0o600);
    });
    return this.persistQueue;
  }
}

function validateStartInput(input: StartInput): void {
  if (!isRecord(input)) throw new RunError(400, 'Invalid consultation input.');
  if (typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 128) throw new RunError(400, 'requestId is required.');
  if (typeof input.stock !== 'string' || !input.stock.trim() || input.stock.length > 40) throw new RunError(400, 'stock is required.');
  if (typeof input.text !== 'string' || !Array.isArray(input.images) || !input.images.every(isImageRef)) {
    throw new RunError(400, 'Malformed text or image references.');
  }
  if ((!input.text.trim() && input.images.length === 0)) throw new RunError(400, 'Provide text, images, or both.');
  if (input.text.length > 20_000) throw new RunError(413, 'Consultation text is too large.');
  if (typeof input.machineId !== 'string' || !input.machineId.trim()
    || typeof input.directory !== 'string' || !input.directory.trim()) throw new RunError(400, 'machineId and directory are required.');
  if (input.mode !== 'single' && input.mode !== 'consultation') throw new RunError(400, 'Invalid consultation mode.');
  if (!isRecord(input.agents)) throw new RunError(400, 'agents are required.');
  for (const role of ROLE_IDS) {
    if (!['codex', 'claude', 'gemini', 'opencode'].includes(input.agents?.[role])) throw new RunError(400, `Invalid engine for ${role}.`);
  }
}

function boundedCompleteContext(history: DecodedPartyMessage[]): string {
  const text = history.map(message => `${message.from}: ${message.text}`).join('\n');
  if (text.length > 128_000) throw new RunError(413, 'Complete party history exceeds the follow-up context budget.');
  return text;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { cleanup(); reject(abortReason(signal)); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw abortReason(signal); }
function abortReason(signal: AbortSignal): Error { return signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'); }
function clone<T>(value: T): T { return structuredClone(value); }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isImageRef(value: unknown): value is ImageRef {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.mimeType === 'string'
    && typeof value.size === 'number';
}

function deadlineSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(abortReason(parent));
  if (parent.aborted) onAbort();
  else parent.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Remote turn deadline exceeded.')), Math.max(0, timeoutMs));
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); parent.removeEventListener('abort', onAbort); },
  };
}
