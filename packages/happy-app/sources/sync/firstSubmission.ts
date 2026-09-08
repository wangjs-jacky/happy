import type { AttachmentPreview } from './attachmentTypes';
import type { NewSessionAgentType } from './persistence';
import type { LocalMessageQueueReceipt } from './sync';

export type FirstSubmissionInput = {
    text: string; prompt: string; machineId: string; path: string | null;
    agent: NewSessionAgentType; worktreeKey: string | null;
    permissionMode?: string | null; modelMode?: string | null; effortLevel?: string | null;
    fastMode?: boolean; sidebarListId?: string | null;
    attachments: { id: string; name: string }[];
};
export type FirstSubmissionSnapshot = FirstSubmissionInput & {
    version: 1; scope: string;
    phase: 'saving' | 'spawning' | 'hydrating' | 'sending' | 'projecting' | 'ready' | 'failed';
    sessionId?: string;
    failure?: 'storage' | 'interrupted' | 'cancelled' | 'hydrate' | 'send' | 'project' | 'spawn';
    retry?: 'hydrate' | 'send' | 'project';
};
export type FirstSubmissionLive = {
    images: AttachmentPreview[];
    directory?: string;
    environmentVariables?: Record<string, string>;
    released?: () => void;
    accepted?: () => void;
};
type Dependencies = {
    save(scope: string, value: string): Promise<void>;
    read(scope: string): string | undefined;
    spawn(input: FirstSubmissionInput, live: FirstSubmissionLive, current: () => boolean): Promise<{ type: 'success'; sessionId: string } | { type: 'cancelled' | 'error' }>;
    hydrate(sessionId: string): Promise<boolean>;
    configure(sessionId: string, input: FirstSubmissionInput): void;
    send(sessionId: string, input: FirstSubmissionInput, live: FirstSubmissionLive, current: () => boolean): Promise<LocalMessageQueueReceipt>;
    project(receipt: LocalMessageQueueReceipt): Promise<boolean>;
    accepted(input: FirstSubmissionInput, live: FirstSubmissionLive): void;
    metric(phase: FirstSubmissionSnapshot['phase'], duration: number): void;
};

/** A single scoped operation owns work, not a mounted composer. Disk is a
 * recovery record, never a durable outbox: refresh cannot prove RPC acceptance. */
export class FirstSubmissionOwner {
    private snapshot: FirstSubmissionSnapshot | null = null;
    private scope = '';
    private generation = 0;
    private current = () => false;
    private busy = false;
    private clearing = false;
    private live?: FirstSubmissionLive;
    private receipt?: LocalMessageQueueReceipt;
    private listeners = new Set<() => void>();
    constructor(private deps: Dependencies) {}
    getSnapshot = () => this.snapshot;
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    private publish(value: FirstSubmissionSnapshot | null) { this.snapshot = value; this.listeners.forEach(listener => listener()); }

    activate(scope: string, current: () => boolean) {
        this.generation++; this.scope = scope; this.current = current;
        this.busy = false; this.clearing = false; this.live = undefined; this.receipt = undefined;
        let recovered: FirstSubmissionSnapshot | null = null;
        try {
            const raw = scope ? this.deps.read(scope) : undefined;
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed?.version === 1 && parsed.scope === scope && typeof parsed.text === 'string'
                && typeof parsed.prompt === 'string' && Array.isArray(parsed.attachments)) {
                recovered = { ...parsed, phase: 'failed', failure: 'interrupted', retry: undefined };
            }
        } catch { /* An unreadable record never authorizes a send. */ }
        this.publish(recovered);
    }

    async submit(input: FirstSubmissionInput, live: FirstSubmissionLive): Promise<boolean> {
        if (this.busy || this.snapshot || !this.current()) return false;
        this.busy = true;
        const generation = this.generation;
        const current = () => generation === this.generation && this.current();
        // Explicit whitelist: never serialize live API credentials, blobs or machine metadata.
        const { text, prompt, machineId, path, agent, worktreeKey, permissionMode, modelMode, effortLevel, fastMode, sidebarListId } = input;
        this.live = { ...live, images: live.images.map(image => ({ ...image })) };
        this.publish({ version: 1, scope: this.scope, phase: 'saving', text, prompt, machineId, path, agent, worktreeKey,
            permissionMode, modelMode, effortLevel, fastMode, sidebarListId, attachments: input.attachments.map(({ id, name }) => ({ id, name })) });
        try {
            await this.persist('saving', current);
            if (!current()) return false;
            live.released?.();
            await this.persist('spawning', current);
            if (!current()) return false;
            const result = await this.deps.spawn(this.snapshot!, this.live, current);
            if (!current()) return false;
            if (result.type !== 'success') {
                this.fail(result.type === 'cancelled' ? 'cancelled' : 'spawn');
                return false;
            }
            this.publish({ ...this.snapshot!, sessionId: result.sessionId });
            return await this.finish('hydrate', current);
        } catch {
            if (current()) {
                if (this.receipt) this.fail('storage', 'project');
                else this.fail(this.getSnapshot()?.phase === 'saving' ? 'storage' : 'interrupted');
            }
            return false;
        } finally { if (generation === this.generation) this.busy = false; }
    }

    private async persist(phase: FirstSubmissionSnapshot['phase'], current: () => boolean) {
        const next = { ...this.snapshot!, phase, failure: undefined, retry: undefined };
        const start = Date.now();
        await this.deps.save(next.scope, JSON.stringify(next));
        if (!current()) return;
        this.publish(next);
        try { this.deps.metric(phase, Date.now() - start); } catch { /* optional metrics */ }
    }
    private fail(failure: FirstSubmissionSnapshot['failure'], retry?: FirstSubmissionSnapshot['retry']) {
        this.publish({ ...this.snapshot!, phase: 'failed', failure, retry });
    }
    private async finish(stage: NonNullable<FirstSubmissionSnapshot['retry']>, current: () => boolean) {
        const sessionId = this.snapshot!.sessionId!;
        if (stage === 'hydrate') {
            await this.persist('hydrating', current);
            if (!current()) return false;
            if (!await this.deps.hydrate(sessionId)) {
                if (current()) this.fail('hydrate', 'hydrate');
                return false;
            }
            if (!current()) return false;
            this.deps.configure(sessionId, this.snapshot!);
        }
        if (stage !== 'project') {
            await this.persist('sending', current);
            if (!current()) return false;
            try {
                const receipt = await this.deps.send(sessionId, this.snapshot!, this.live!, current);
                if (!current()) return false;
                if (receipt?.type !== 'queued' || receipt.sessionId !== sessionId || !receipt.localIds.length) {
                    this.fail('interrupted'); return false;
                }
                this.receipt = receipt;
            } catch {
                // sendMessage is atomic: rejection happens before queue acceptance.
                if (current()) this.fail('send', 'send');
                return false;
            }
            // Cleanup is ancillary after acceptance; it can never authorize a resend.
            try { this.deps.accepted(this.snapshot!, this.live!); } catch { /* recovery record remains */ }
        }
        await this.persist('projecting', current);
        if (!current()) return false;
        try {
            if (!await this.deps.project(this.receipt!)) {
                if (current()) this.fail('project', 'project');
                return false;
            }
        } catch { if (current()) this.fail('project', 'project'); return false; }
        if (!current()) return false;
        await this.persist('ready', current);
        return current();
    }
    async retry(expected = this.snapshot): Promise<boolean> {
        if (expected !== this.snapshot || this.busy || !this.live || !this.snapshot?.retry || !this.current()) return false;
        this.busy = true;
        const generation = this.generation;
        const current = () => generation === this.generation && this.current();
        try { return await this.finish(this.snapshot.retry, current); }
        catch { if (current()) this.fail('storage', this.receipt ? 'project' : undefined); return false; }
        finally { if (generation === this.generation) this.busy = false; }
    }
    async dismiss(expected = this.snapshot): Promise<boolean> {
        if (this.clearing || expected !== this.snapshot || (this.busy && this.snapshot?.phase !== 'ready') || !this.current()) return false;
        this.clearing = true;
        const generation = this.generation;
        try {
            await this.deps.save(this.scope, 'null');
            if (generation !== this.generation || !this.current()) return false;
            this.live = undefined; this.receipt = undefined; this.publish(null); return true;
        } catch {
            if (generation === this.generation && this.current() && this.receipt) this.fail('storage', 'project');
            return false;
        }
        finally { if (generation === this.generation) this.clearing = false; }
    }
}
