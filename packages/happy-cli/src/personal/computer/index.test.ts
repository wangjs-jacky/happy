import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalComputer } from './index';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }); });
function computer() {
    const home = mkdtempSync(join(tmpdir(), 'paws-computer-unit-')); homes.push(home);
    const frames = vi.fn();
    const runtime = new PersonalComputer({ home, onFrame: frames });
    const cdp = { request: vi.fn().mockResolvedValue({ result: { value: '{"url":"about:blank","title":""}' } }), close: vi.fn() };
    const internals = runtime as any;
    internals.phase = 'ready'; internals.cdp = cdp;
    vi.spyOn(internals, 'docker').mockResolvedValue('');
    return { runtime, internals, cdp, home, frames };
}

describe('Personal computer authenticated ownership flows', () => {
    it('keeps the lease across unview and supports explicit reclaim after refresh', async () => {
        const { runtime } = computer();
        const first = await runtime.request({ action: 'takeover', viewerId: 'old-page' });
        expect(first.state.control).toBe('human');
        await runtime.request({ action: 'unview', viewerId: 'old-page' });
        expect(runtime.state().controllerId).toBe('old-page');
        const reclaimed = await runtime.request({ action: 'takeover', viewerId: 'refreshed-page' });
        await expect(runtime.request({ action: 'release', viewerId: 'old-page', epoch: first.state.epoch })).rejects.toThrow();
        await expect(runtime.request({ action: 'input', viewerId: 'old-page', epoch: first.state.epoch, input: { kind: 'key', key: 'Enter' } })).rejects.toThrow();
        await runtime.request({ action: 'release', viewerId: 'refreshed-page', epoch: reclaimed.state.epoch });
        expect(runtime.state().control).toBe('agent');
        expect(runtime.state().controllerId).toBeUndefined();
        await runtime.dispose();
    });

    it('cancels an active agent command before confirming human takeover', async () => {
        const { runtime, internals } = computer();
        let started!: () => void;
        const running = new Promise<void>(resolve => { started = resolve; });
        vi.spyOn(internals, 'job').mockImplementation(async (...args: unknown[]) => {
            const signal = args[1] as AbortSignal;
            started();
            return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Job cancelled')), { once: true }));
        });
        const command = runtime.runCommand('sleep 60', new AbortController().signal);
        const failure = expect(command).rejects.toThrow('cancelled');
        await running;
        await runtime.request({ action: 'takeover', viewerId: 'phone' });
        await failure;
        expect(runtime.state().control).toBe('human');
        await runtime.dispose();
    });

    it('waits by an event while human-owned and resumes only after explicit release', async () => {
        const { runtime } = computer();
        const owned = await runtime.request({ action: 'takeover', viewerId: 'phone' });
        let resumed = false;
        const waiting = runtime.waitForAgentControl(new AbortController().signal).then(() => { resumed = true; });
        await Promise.resolve(); expect(resumed).toBe(false);
        await runtime.request({ action: 'unview', viewerId: 'phone' });
        expect(resumed).toBe(false);
        await runtime.request({ action: 'release', viewerId: 'phone', epoch: owned.state.epoch });
        await waiting; expect(resumed).toBe(true);
        await runtime.dispose();
    });

    it('fails closed when a persisted lease is corrupt', () => {
        const { home } = computer();
        writeFileSync(join(home, 'computer-control.json'), '{partial');
        const replacement = new PersonalComputer({ home, onFrame() {} });
        expect(replacement.state().control).toBe('human');
        expect(replacement.state().controllerId).toBe('interrupted-runtime');
    });

    it('holds an exclusive cross-instance controller lock and releases only its own record', async () => {
        const { runtime, internals, home } = computer();
        internals.claim();
        const other = new PersonalComputer({ home, onFrame() {} });
        expect(() => (other as any).claim()).toThrow('already owned');
        await runtime.dispose();
        expect(() => (other as any).claim()).not.toThrow();
        await other.dispose();
    });

    it('recovers a confirmed-dead owner into a durable human pause', async () => {
        const { runtime, internals, home } = computer();
        writeFileSync(join(home, 'computer-runtime.lock'), JSON.stringify({ pid: 2147483647, nonce: 'dead' }));
        internals.claim();
        expect(runtime.state().control).toBe('human');
        expect(runtime.state().controllerId).toBe('interrupted-runtime');
        await runtime.dispose();
    });

    it('fences release and human input until takeover cancellation finishes', async () => {
        const { runtime, internals } = computer();
        let finish!: () => void;
        vi.spyOn(internals, 'abortActions').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const takeover = runtime.request({ action: 'takeover', viewerId: 'phone' });
        const epoch = runtime.state().epoch;
        await expect(runtime.request({ action: 'release', viewerId: 'phone', epoch })).rejects.toThrow('transition');
        await expect(runtime.request({ action: 'input', viewerId: 'phone', epoch, input: { kind: 'key', key: 'Enter' } })).rejects.toThrow('transition');
        finish(); await takeover;
        await runtime.dispose();
    });

    it('observes the current page before handing control back to agent work', async () => {
        const { runtime, internals } = computer();
        const owned = await runtime.request({ action: 'takeover', viewerId: 'phone' });
        let observeDone!: () => void;
        vi.spyOn(internals, 'observe').mockImplementationOnce(() => new Promise<void>(resolve => { observeDone = resolve; }));
        let resumed = false;
        const waiting = runtime.waitForAgentControl(new AbortController().signal).then(() => { resumed = true; });
        const release = runtime.request({ action: 'release', viewerId: 'phone', epoch: owned.state.epoch });
        expect(runtime.state().control).toBe('human');
        await Promise.resolve(); expect(resumed).toBe(false);
        observeDone(); await release; await waiting;
        expect(resumed).toBe(true);
        await runtime.dispose();
    });

    it('dispose prevents queued work from starting during cleanup', async () => {
        const { runtime, internals } = computer();
        let drain!: () => void;
        internals.operation = new Promise<void>(resolve => { drain = resolve; });
        const job = vi.spyOn(internals, 'job');
        const queued = expect(runtime.runCommand('printf forbidden', new AbortController().signal)).rejects.toThrow();
        const disposing = runtime.dispose();
        await expect(runtime.request({ action: 'start' })).rejects.toThrow('disposed');
        drain(); await queued; await disposing;
        expect(job).not.toHaveBeenCalled();
    });

    it('starting an already ready computer preserves its ready state', async () => {
        const { runtime, internals } = computer();
        const provision = vi.spyOn(internals, 'provision');
        await runtime.request({ action: 'start' });
        expect(runtime.state().phase).toBe('ready'); expect(provision).not.toHaveBeenCalled();
        await runtime.dispose();
    });

    it('binds chrome-use to the displayed target and checks identity around each semantic command', async () => {
        const { runtime, internals } = computer();
        internals.browserTarget = 'expected-target';
        const docker = internals.docker as ReturnType<typeof vi.fn>;
        docker.mockImplementation(async (args: string[]) => {
            if (args.includes('adopt')) return JSON.stringify({ success: true, data: { targetId: 'expected-target', verified: 'confirmed' } });
            if (args.includes('list')) return JSON.stringify({ success: true, data: { tabs: [{ active: true, targetId: 'expected-target' }] } });
            return JSON.stringify({ success: true, data: {} });
        });
        await runtime.snapshot(new AbortController().signal);
        const commands = docker.mock.calls.map(call => call[0] as string[]);
        expect(commands.some(args => args.includes('connect'))).toBe(true);
        expect(commands.some(args => args.includes('NO_PROXY=127.0.0.1,localhost,::1'))).toBe(true);
        expect(commands.filter(args => args.includes('list'))).toHaveLength(2);
        await runtime.dispose();
    });

    it('kills chrome-use workers when initial binding is cancelled', async () => {
        const { runtime, internals } = computer();
        internals.browserTarget = 'expected-target';
        const docker = internals.docker as ReturnType<typeof vi.fn>;
        docker.mockImplementation(async (args: string[]) => {
            if (args.includes('connect')) throw new Error('cancelled');
            return '';
        });
        await expect(runtime.snapshot(new AbortController().signal)).rejects.toThrow('cancelled');
        expect(docker.mock.calls.some(call => (call[0] as string[]).includes('/opt/paws/kill-chrome-use.mjs'))).toBe(true);
        expect(internals.chromeUseBound).toBe(false);
        await runtime.dispose();
    });

    it('cleans a partially attached connection on status failure so Start can retry', async () => {
        const { runtime, internals, cdp } = computer();
        internals.cdp = null;
        const close = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(internals, 'attachBrowser').mockImplementationOnce(async () => {
            internals.cdp = cdp; internals.tunnel = { close };
            throw new Error('Page.enable timeout');
        });
        const status = await runtime.request({ action: 'status' });
        expect(status.state.phase).toBe('error'); expect(internals.cdp).toBeNull();
        expect(cdp.close).toHaveBeenCalled(); expect(close).toHaveBeenCalled();
        await runtime.dispose();
    });

    it('rejects work during stop even if an in-flight attach temporarily sets ready', async () => {
        const { runtime, internals } = computer();
        internals.stopping = Promise.resolve();
        await expect(runtime.runCommand('printf forbidden', new AbortController().signal)).rejects.toThrow('Start');
        internals.stopping = null;
        await runtime.dispose();
    });

    it('keeps repeated view idempotent after takeover and for additional viewers', async () => {
        const { runtime, cdp } = computer();
        cdp.request.mockImplementation(async (method: string) => method === 'Page.captureScreenshot'
            ? { data: 'fresh-jpeg' } : { result: { value: '{"url":"about:blank","title":""}' } });
        await runtime.request({ action: 'view', viewerId: 'phone' });
        const owned = await runtime.request({ action: 'takeover', viewerId: 'phone' });
        const view = await runtime.request({ action: 'view', viewerId: 'phone' });
        expect(view.frame?.epoch).toBe(owned.state.epoch);
        await runtime.request({ action: 'view', viewerId: 'other-viewer' });
        // First subscriber and the takeover refresh each start once.
        expect(cdp.request.mock.calls.filter(call => call[0] === 'Page.startScreencast')).toHaveLength(2);
        await runtime.dispose();
    });

    it('retries a failed cast start and deduplicates concurrent subscriptions', async () => {
        const { runtime, cdp } = computer();
        let starts = 0, active = false;
        cdp.request.mockImplementation(async (method: string) => {
            if (method === 'Page.startScreencast') {
                starts++;
                if (starts === 1) { active = true; throw new Error('Transient cast failure after dispatch'); }
                if (active) throw new Error('Screencast is already active');
                active = true;
            }
            if (method === 'Page.stopScreencast') active = false;
            return method === 'Page.captureScreenshot' ? { data: 'fresh-jpeg' } : { result: { value: '{"url":"about:blank","title":""}' } };
        });
        await expect(runtime.request({ action: 'view', viewerId: 'phone' })).rejects.toThrow('Transient');
        await Promise.all([runtime.request({ action: 'view', viewerId: 'phone' }), runtime.request({ action: 'view', viewerId: 'tablet' })]);
        expect(starts).toBe(2); expect(active).toBe(true);
        await runtime.request({ action: 'unview', viewerId: 'phone' }); expect(active).toBe(true);
        await runtime.request({ action: 'unview', viewerId: 'tablet' }); expect(active).toBe(false);
        await runtime.request({ action: 'view', viewerId: 'phone' }); expect(starts).toBe(3);
        await runtime.dispose();
    });

    it('Stop releases owned containers and networks while preserving data volumes', async () => {
        const { runtime, internals } = computer();
        vi.spyOn(internals, 'inspect').mockImplementation(async (...args: unknown[]) => {
            const labels = { 'build.paws.personal-computer': internals.owner };
            return args[0] === 'container' ? { Config: { Labels: labels } } : { Labels: labels };
        });
        await runtime.request({ action: 'stop', epoch: runtime.state().epoch });
        const commands = internals.docker.mock.calls.map((call: unknown[]) => call[0] as string[]);
        expect(commands).toContainEqual(['rm', internals.name]);
        expect(commands).toContainEqual(['rm', internals.proxy]);
        expect(commands).toContainEqual(['network', 'rm', internals.browserNetwork]);
        expect(commands).toContainEqual(['network', 'rm', internals.jobsNetwork]);
        expect(commands.some((args: string[]) => args.includes('volume') || args.includes('-v'))).toBe(false);
        await runtime.dispose();
    });
});
