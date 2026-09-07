import { ApiMessageSchema, type ApiMessage } from './apiTypes';

type Page = { messages: ApiMessage[]; hasMore: boolean };
type Task = {
    key: object;
    sessionId: string;
    beforeSeq: number;
    isCurrent: () => boolean;
    canRun: () => boolean;
    read: (beforeSeq: number) => Promise<Page | null>;
    fetch: (beforeSeq: number, signal: AbortSignal) => Promise<Page>;
    write: (beforeSeq: number, page: Page) => Promise<boolean>;
};
type Run = { task: Task; boundary: number; failures: number; controller?: AbortController;
    timer?: ReturnType<typeof setTimeout>; pending?: Promise<void> };

/** Downloads encrypted pages only. It never decrypts, projects messages, or moves
 * a reading window. Durable coverage is the resume cursor, including after restart. */
export class SessionHistoryPrefetch {
    private run?: Run;

    start(task: Task): void {
        if (this.run?.task.key === task.key) return;
        this.stop();
        if (task.beforeSeq <= 1 || !task.isCurrent()) return;
        const run: Run = { task, boundary: task.beforeSeq, failures: 0 };
        this.run = run;
        this.schedule(run, 1000);
    }

    stop(): void {
        const run = this.run;
        this.run = undefined;
        if (run?.timer) clearTimeout(run.timer);
        run?.controller?.abort();
    }

    async waitForPage(sessionId: string, boundary: number): Promise<void> {
        const run = this.run;
        if (run?.task.sessionId === sessionId && run.boundary === boundary) await run.pending;
    }

    private current(run: Run): boolean { return this.run === run && run.task.isCurrent(); }

    private schedule(run: Run, delay: number): void {
        if (!this.current(run)) { if (this.run === run) this.stop(); return; }
        run.timer = setTimeout(() => {
            run.timer = undefined;
            run.pending = this.step(run);
        }, delay);
    }

    private valid(page: Page, boundary: number): boolean {
        return typeof page?.hasMore === 'boolean' && ApiMessageSchema.array().safeParse(page.messages).success
            && (!page.hasMore || page.messages.length > 0)
            && page.messages.every(message => message.content.t === 'encrypted'
                && Number.isInteger(message.seq) && message.seq > 0 && message.seq < boundary);
    }

    private async step(run: Run): Promise<void> {
        if (!this.current(run)) { if (this.run === run) this.stop(); return; }
        if (!run.task.canRun()) { this.schedule(run, 1000); return; }
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
            let page = await run.task.read(run.boundary);
            if (!this.current(run)) return;
            if (page && !this.valid(page, run.boundary)) page = null;
            const cached = page !== null;
            if (!page) {
                // Recheck after the asynchronous cache read: a foreground load
                // may have acquired this boundary in the meantime.
                if (!run.task.canRun()) { this.schedule(run, 1000); return; }
                const controller = new AbortController();
                run.controller = controller;
                timeout = setTimeout(() => controller.abort(), 15000);
                page = await run.task.fetch(run.boundary, controller.signal);
                if (!this.current(run)) return;
                if (controller.signal.aborted) throw new Error('History prefetch timed out');
                if (!this.valid(page, run.boundary)) throw new Error('Invalid history prefetch page');
                if (!await run.task.write(run.boundary, page)) {
                    // Quota/unavailable persistence: leave manual loading usable.
                    if (this.run === run) this.stop();
                    return;
                }
            }
            if (!this.current(run)) return;
            if (!page.hasMore) { this.stop(); return; }
            run.boundary = Math.min(...page.messages.map(message => message.seq));
            run.failures = 0;
            if (run.boundary <= 1) { this.stop(); return; }
            // Yield between disk reads too; large archives must not monopolize JS.
            this.schedule(run, cached ? 20 : 750);
        } catch {
            if (!this.current(run)) return;
            if (++run.failures >= 3) { this.stop(); return; }
            this.schedule(run, 2000 * run.failures);
        } finally {
            if (timeout) clearTimeout(timeout);
            run.controller = undefined;
        }
    }
}
