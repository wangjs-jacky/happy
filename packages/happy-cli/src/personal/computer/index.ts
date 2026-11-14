import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PersonalComputerFrame, PersonalComputerInput, PersonalComputerRequest, PersonalComputerResponse, PersonalComputerState } from '@slopus/happy-wire';
import { projectPath } from '@/projectPath';
import { ComputerCdp } from './cdp';
import { browserUrl, ComputerControl, workspacePath } from './policy';
import { computerTunnel } from './tunnel';

const LABEL = 'build.paws.personal-computer';
const RECIPE_LABEL = 'build.paws.personal-computer.recipe';
const WIDTH = 1280, HEIGHT = 800;
type Options = { home: string; onFrame: (frame: PersonalComputerFrame) => void };

/** Trusted, host-side controller. Agent code never receives Docker or raw CDP. */
export class PersonalComputer {
    private readonly owner: string;
    private readonly name: string;
    private readonly browserNetwork: string;
    private readonly jobsNetwork: string;
    private readonly workspace: string;
    private readonly profile: string;
    private readonly proxy: string;
    private readonly home: string;
    private readonly image: string;
    private readonly recipe: string;
    private readonly assets: string;
    private readonly control = new ComputerControl();
    private readonly changes = new EventEmitter();
    private readonly viewers = new Set<string>();
    private readonly tasks = new Set<string>();
    private readonly controllers = new Set<AbortController>();
    private phase: PersonalComputerState['phase'] = 'stopped';
    private error: string | undefined;
    private url = 'about:blank';
    private title = '';
    private cdp: ComputerCdp | null = null;
    private sequence = 0;
    private lastFrame: Omit<PersonalComputerFrame, 'viewerId'> | null = null;
    private operation: Promise<unknown> = Promise.resolve();
    private starting: Promise<void> | null = null;
    private attaching: Promise<void> | null = null;
    private stopping: Promise<void> | null = null;
    private lockNonce: string | null = null;
    private browserTarget: string | null = null;
    private chromeUseBound = false;
    private lifecycleAbort: AbortController | null = null;
    private frameFenceAt = Date.now() / 1000;
    private tunnel: Awaited<ReturnType<typeof computerTunnel>> | null = null;
    private controlTransition: Promise<void> | null = null;
    private casting = false;
    private castingOperation: Promise<void> = Promise.resolve();
    private disposed = false;

    constructor(private readonly options: Options) {
        this.home = resolve(options.home);
        this.assets = join(projectPath(), 'tools', 'personal-computer');
        const recipe = createHash('sha256');
        for (const file of ['Dockerfile', 'start.sh', 'egress.mjs', 'workspace.mjs', 'command.mjs', 'kill-chrome-use.mjs']) {
            recipe.update(file); recipe.update('\0'); recipe.update(readFileSync(join(this.assets, file))); recipe.update('\0');
        }
        this.recipe = recipe.digest('hex'); this.image = `paws-personal-computer:${this.recipe.slice(0, 20)}`;
        this.owner = createHash('sha256').update(this.home).digest('hex').slice(0, 16);
        this.name = `paws-pc-${this.owner}`;
        this.proxy = `${this.name}-egress`;
        this.browserNetwork = `${this.name}-browser`;
        this.jobsNetwork = `${this.name}-jobs`;
        this.workspace = `${this.name}-workspace`;
        this.profile = `${this.name}-profile`;
        try {
            const saved = JSON.parse(readFileSync(join(this.home, 'computer-control.json'), 'utf8'));
            if (!Number.isSafeInteger(saved.epoch) || saved.epoch < 0 || !(saved.viewer === null || typeof saved.viewer === 'string' && saved.viewer.length <= 128)) throw new Error('Invalid control record');
            this.control.epoch = saved.epoch; this.control.viewer = saved.viewer;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.control.epoch = Date.now(); this.control.viewer = 'interrupted-runtime';
            }
        }
    }

    state(): PersonalComputerState {
        return { available: true, phase: this.phase, control: this.control.viewer ? 'human' : 'agent',
            epoch: this.control.epoch, width: WIDTH, height: HEIGHT,
            ...(this.control.viewer ? { controllerId: this.control.viewer } : {}),
            ...(this.phase === 'ready' ? { url: this.url, title: this.title } : {}), ...(this.error ? { error: this.error } : {}) };
    }

    private persistControl(): void {
        this.lastFrame = null; this.frameFenceAt = Date.now() / 1000;
        mkdirSync(this.home, { recursive: true, mode: 0o700 });
        const file = join(this.home, 'computer-control.json');
        const temporary = `${file}.${randomUUID()}.tmp`;
        writeFileSync(temporary, JSON.stringify({ epoch: this.control.epoch, viewer: this.control.viewer }), { flag: 'wx', mode: 0o600 });
        renameSync(temporary, file);
        this.changes.emit('control');
    }

    private claim(): void {
        if (this.lockNonce) return;
        mkdirSync(this.home, { recursive: true, mode: 0o700 });
        const file = join(this.home, 'computer-runtime.lock');
        const recovery = `${file}.recovery`;
        const nonce = randomUUID();
        if (existsSync(recovery)) throw new Error('Computer ownership recovery is already in progress');
        const claim = () => writeFileSync(file, JSON.stringify({ pid: process.pid, nonce, processStartedAt: Date.now() - process.uptime() * 1000 }), { flag: 'wx', mode: 0o600 });
        try { claim(); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            // A separate mkdir guard serializes stale-lock recovery, so two
            // replacements can never unlink each other's freshly acquired lock.
            try { mkdirSync(recovery, { mode: 0o700 }); } catch { throw new Error('Computer ownership recovery is already in progress'); }
            try {
                let pid: number;
                try { pid = JSON.parse(readFileSync(file, 'utf8')).pid; } catch { throw new Error('Computer ownership record needs manual recovery'); }
                if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid computer ownership record');
                try { process.kill(pid, 0); throw new Error('Computer is already owned by another Personal runtime'); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
                // Persist the interrupted fence before making the public lock
                // name available to any competing first-time claimant.
                this.control.viewer = 'interrupted-runtime'; this.control.epoch++;
                this.persistControl();
                rmSync(file); claim();
            } finally { rmdirSync(recovery); }
        }
        this.lockNonce = nonce;
        // A recovery may have completed between this instance's constructor
        // and its successful exclusive create. Respect that durable fence.
        try {
            const saved = JSON.parse(readFileSync(join(this.home, 'computer-control.json'), 'utf8')) as { epoch: number; viewer: string | null };
            if (Number.isSafeInteger(saved.epoch) && saved.epoch > this.control.epoch) { this.control.epoch = saved.epoch; this.control.viewer = saved.viewer; }
        } catch { this.persistControl(); }
    }

    private docker(args: string[], signal?: AbortSignal, input?: string, timeout = 120_000): Promise<string> {
        signal?.throwIfAborted();
        return new Promise((resolve, reject) => {
            const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DOCKER_CLI_HINTS: 'false' } });
            let stdout = '', stderr = '', size = 0, failure: Error | undefined;
            const cancel = () => { failure = new Error('Computer operation cancelled'); child.kill('SIGKILL'); };
            const timer = setTimeout(() => { failure = new Error('Computer operation timed out'); child.kill('SIGKILL'); }, timeout);
            signal?.addEventListener('abort', cancel, { once: true });
            child.stdout.on('data', data => { size += data.length; if (size <= 4 * 1024 * 1024) stdout += data; else { failure = new Error('Computer output exceeded its limit'); child.kill('SIGKILL'); } });
            child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16000); });
            const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
            child.once('error', error => { finish(); reject(new Error(`Docker is unavailable: ${error.message}`)); });
            child.once('close', code => { finish(); if (failure) reject(failure); else if (code !== 0) reject(new Error(stderr.trim().slice(-1000) || `Docker exited with ${code}`)); else resolve(stdout); });
            child.stdin.on('error', () => {});
            child.stdin.end(input);
        });
    }

    private async inspect(kind: 'container' | 'network' | 'volume' | 'image', name: string): Promise<any | null> {
        try { return JSON.parse(await this.docker([kind, 'inspect', name]))[0] ?? null; }
        catch (error) {
            if (/No such (?:object|container|network|volume|image)|not found/i.test(String(error))) return null;
            throw error;
        }
    }

    private assertOwned(info: any): void {
        const labels = info.Config?.Labels ?? info.Labels;
        if (labels?.[LABEL] !== this.owner) throw new Error('Refusing to use an unrelated Docker resource');
    }

    private commonRun(name: string, network: string): string[] {
        return ['run', '--name', name, '--label', `${LABEL}=${this.owner}`, '--network', network,
            '--user', '1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only',
            '--pids-limit', '256', '--memory', '2g', '--cpus', '2', '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
            '--env', 'HTTP_PROXY=http://paws-egress:3128', '--env', 'HTTPS_PROXY=http://paws-egress:3128',
            '--env', 'http_proxy=http://paws-egress:3128', '--env', 'https_proxy=http://paws-egress:3128',
            '--env', 'HOME=/tmp', '--workdir', '/workspace'];
    }

    private async provision(signal?: AbortSignal): Promise<void> {
        this.claim();
        const image = await this.inspect('image', this.image);
        if (!image) {
            await this.docker(['build', '--tag', this.image, '--label', `${RECIPE_LABEL}=${this.recipe}`, this.assets], signal, undefined, 1800_000);
        } else if (image.Config?.Labels?.[RECIPE_LABEL] !== this.recipe) {
            throw new Error('Computer image does not match the trusted recipe');
        }
        for (const name of [this.browserNetwork, this.jobsNetwork]) {
            const info = await this.inspect('network', name);
            if (info) { this.assertOwned(info); if (!info.Internal) throw new Error('Computer network is not internal'); }
            else await this.docker(['network', 'create', '--internal', '--label', `${LABEL}=${this.owner}`, name], signal);
        }
        for (const name of [this.workspace, this.profile]) {
            const info = await this.inspect('volume', name);
            if (info) this.assertOwned(info);
            else {
                await this.docker(['volume', 'create', '--label', `${LABEL}=${this.owner}`, name], signal);
                // Initialize ownership before any untrusted process can access it.
                await this.docker(['run', '--rm', '--network=none', '--cap-drop=ALL', '--cap-add=CHOWN', '--user=0:0',
                    '--mount', `type=volume,src=${name},dst=/volume`, this.image, 'chown', '1000:1000', '/volume'], signal);
            }
        }
        let proxyInfo = await this.inspect('container', this.proxy);
        if (proxyInfo) { this.assertOwned(proxyInfo); if (proxyInfo.Config.Image !== this.image) { await this.docker(['rm', '-f', this.proxy], signal); proxyInfo = null; } }
        if (proxyInfo) { this.assertOwned(proxyInfo); if (!proxyInfo.State.Running) await this.docker(['start', this.proxy], signal); }
        else {
            await this.docker(['run', '-d', '--name', this.proxy, '--label', `${LABEL}=${this.owner}`, '--network=bridge',
                '--user=1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                '--pids-limit=64', '--memory=256m', '--cpus=0.5', this.image, 'node', '/opt/paws/egress.mjs'], signal);
        }
        const proxy = await this.inspect('container', this.proxy);
        for (const network of [this.browserNetwork, this.jobsNetwork]) {
            if (!proxy.NetworkSettings.Networks[network]) await this.docker(['network', 'connect', '--alias=paws-egress', network, this.proxy], signal);
        }
        let browser = await this.inspect('container', this.name);
        if (browser) { this.assertOwned(browser); if (browser.Config.Image !== this.image) { await this.docker(['rm', '-f', this.name], signal); browser = null; } }
        if (browser) { this.assertOwned(browser); if (!browser.State.Running) await this.docker(['start', this.name], signal); }
        else {
            await this.docker([...this.commonRun(this.name, this.browserNetwork), '-d', '--hostname', this.name, '--shm-size=512m',
                '--mount', `type=volume,src=${this.workspace},dst=/workspace`,
                '--mount', `type=volume,src=${this.profile},dst=/profile`, this.image], signal);
        }
    }

    private async attach(signal?: AbortSignal): Promise<void> {
        if (this.attaching) return this.attaching;
        this.attaching = this.attachBrowser(signal);
        try { await this.attaching; }
        catch (error) {
            this.cdp?.close(); this.cdp = null; this.casting = false; this.chromeUseBound = false; this.browserTarget = null;
            await this.tunnel?.close(); this.tunnel = null;
            throw error;
        }
        finally { this.attaching = null; }
    }

    private async attachBrowser(signal?: AbortSignal): Promise<void> {
        if (this.cdp) return;
        const info = await this.inspect('container', this.name);
        if (!info) { this.phase = 'stopped'; return; }
        this.assertOwned(info);
        if (info.Config.Image !== this.image) throw new Error('Computer image changed; select Start to apply the new runtime while preserving files');
        if (!info.State.Running) { this.phase = 'stopped'; return; }
        this.claim();
        const networks = info.NetworkSettings.Networks ?? {};
        if (Object.keys(networks).length !== 1 || !networks[this.browserNetwork]) throw new Error('Computer browser is attached to an unexpected network');
        if (!this.tunnel) this.tunnel = await computerTunnel(this.name);
        const port = this.tunnel.port;
        // One request, bounded timeout. Startup errors are returned to the user;
        // there is no health/status query loop or automatic retry.
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error('Computer browser is not ready; retry Start once it finishes launching');
        const targets = await response.json() as Array<{ id: string; type: string; webSocketDebuggerUrl: string }>;
        const target = targets.find(target => target.type === 'page');
        if (!target?.webSocketDebuggerUrl) throw new Error('Computer browser has no page yet; retry Start');
        const endpoint = new URL(target.webSocketDebuggerUrl);
        endpoint.hostname = '127.0.0.1'; endpoint.port = String(port);
        const cdp = await ComputerCdp.connect(endpoint.href, signal);
        this.cdp = cdp;
        this.browserTarget = target.id;
        cdp.on('closed', () => { if (this.cdp === cdp) { this.cdp = null; this.casting = false; this.chromeUseBound = false; this.browserTarget = null; this.phase = 'error'; this.error = 'Computer connection closed; reopen to reconnect'; this.changes.emit('control'); } });
        cdp.on('Page.screencastFrame', event => {
            void cdp.request('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
            if (typeof event.data !== 'string' || event.data.length > 512 * 1024) return;
            if (!Number.isFinite(event.metadata?.timestamp) || event.metadata.timestamp < this.frameFenceAt) return;
            this.lastFrame = { type: 'personal-computer-frame', sequence: ++this.sequence, epoch: this.control.epoch,
                data: event.data, width: WIDTH, height: HEIGHT };
            for (const viewerId of this.viewers) { try { this.options.onFrame({ ...this.lastFrame, viewerId }); } catch { /* A closed viewer must not crash the controller. */ } }
        });
        await cdp.request('Page.enable', {}, signal);
        await cdp.request('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, signal);
        this.phase = 'ready'; this.error = undefined;
        if (this.viewers.size) await this.setCasting(true, signal);
        await this.observe(signal);
    }

    private async start(signal?: AbortSignal): Promise<void> {
        if (this.stopping) await this.stopping;
        if (this.disposed) throw new Error('Personal computer runtime is disposed');
        if (this.phase === 'ready' && this.cdp) return;
        if (this.starting) return this.starting;
        this.phase = 'starting'; this.error = undefined;
        const lifecycle = new AbortController(); this.lifecycleAbort = lifecycle;
        const current = signal ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal;
        this.starting = (async () => {
            try { await this.provision(current); await this.waitBrowserReady(current); await this.attach(current); }
            catch (error) {
                this.cdp?.close(); this.cdp = null; this.casting = false; this.chromeUseBound = false; this.browserTarget = null;
                await this.tunnel?.close(); this.tunnel = null;
                this.phase = 'error'; this.error = (error instanceof Error ? error.message : 'Computer start failed').slice(0, 500); throw error;
            }
            finally { this.starting = null; if (this.lifecycleAbort === lifecycle) this.lifecycleAbort = null; this.changes.emit('control'); }
        })();
        return this.starting;
    }

    private async abortActions(): Promise<void> {
        for (const controller of this.controllers) controller.abort();
        if (this.cdp) {
            await this.docker(['exec', this.name, 'node', '/opt/paws/kill-chrome-use.mjs']).catch(() => {});
            this.chromeUseBound = false;
        }
        // Removing the exact one-shot task container kills its entire PID
        // namespace, including command children that detached their process group.
        await Promise.all([...this.tasks].map(name => this.docker(['rm', '-f', name]).catch(() => {})));
        await this.operation.catch(() => {});
        if (this.cdp) await this.docker(['exec', this.name, 'node', '/opt/paws/kill-chrome-use.mjs']).catch(() => {});
    }

    async request(request: PersonalComputerRequest, signal?: AbortSignal): Promise<PersonalComputerResponse> {
        signal?.throwIfAborted();
        if (this.disposed) throw new Error('Personal computer runtime is disposed');
        if (request.action === 'status') {
            if (!this.starting && !this.stopping && !this.cdp) { try { await this.attach(signal); } catch (error) { this.phase = 'error'; this.error = (error instanceof Error ? error.message : 'Computer unavailable').slice(0, 500); } }
        } else if (request.action === 'start') await this.start(signal);
        else if (request.action === 'stop') {
            this.claim();
            if (this.stopping) throw new Error('Computer stop is already in progress');
            this.control.stop(request.epoch); this.phase = 'stopped'; this.persistControl();
            this.stopping = (async () => {
                this.lifecycleAbort?.abort(); await this.starting?.catch(() => {});
                await this.attaching?.catch(() => {});
                await this.controlTransition?.catch(() => {});
                await this.abortActions();
                this.cdp?.close(); this.cdp = null; this.casting = false;
                await this.tunnel?.close(); this.tunnel = null;
                for (const name of [this.name, this.proxy]) {
                    const info = await this.inspect('container', name);
                    if (info) {
                        this.assertOwned(info);
                        await this.docker(['stop', '--time=3', name], signal);
                        // Volumes are independent and deliberately retained.
                        await this.docker(['rm', name], signal);
                    }
                }
                for (const name of [this.browserNetwork, this.jobsNetwork]) {
                    const info = await this.inspect('network', name);
                    if (info) { this.assertOwned(info); await this.docker(['network', 'rm', name], signal); }
                }
                this.phase = 'stopped'; this.error = undefined; this.lastFrame = null;
                this.changes.emit('control');
            })();
            try { await this.stopping; }
            catch (error) {
                this.phase = 'error'; this.error = 'Computer stop was not confirmed; inspect before retrying';
                this.control.viewer = 'interrupted-runtime'; this.control.epoch++; this.persistControl();
                throw error;
            } finally { this.stopping = null; }
        } else if (request.action === 'takeover') {
            this.assertReady();
            if (this.controlTransition) throw new Error('Computer control transition is in progress');
            if (this.control.viewer === 'interrupted-runtime') this.control.viewer = null;
            this.control.takeover(request.viewerId); this.persistControl();
            this.controlTransition = (async () => {
                await this.abortActions();
                this.assertReady();
                await this.cdp!.request('Page.stopLoading', {}, signal);
                await this.refreshFrames(signal);
            })();
            try { await this.controlTransition; }
            finally { this.controlTransition = null; this.changes.emit('control'); }
        } else if (request.action === 'release') {
            this.assertReady();
            if (this.controlTransition) throw new Error('Computer control transition is in progress');
            this.control.assertHuman(request.viewerId, request.epoch);
            this.controlTransition = (async () => {
                // Observe while the human lease still fences queued agent work.
                await this.observe(signal); this.assertReady();
                this.control.release(request.viewerId, request.epoch); this.persistControl();
                await this.refreshFrames(signal);
            })();
            try { await this.controlTransition; }
            finally { this.controlTransition = null; this.changes.emit('control'); }
        } else if (request.action === 'view') {
            this.assertReady(); this.viewers.add(request.viewerId);
            await this.setCasting(true, signal);
            await this.captureFrame(signal);
        } else if (request.action === 'unview') {
            this.viewers.delete(request.viewerId);
            if (!this.viewers.size && this.cdp) await this.setCasting(false, signal);
        } else if (request.action === 'input') {
            if (this.controlTransition) throw new Error('Computer control transition is in progress');
            this.assertReady(); this.control.assertHuman(request.viewerId, request.epoch);
            await this.input(request.input, signal, () => this.control.assertHuman(request.viewerId, request.epoch));
        }
        const frame = 'viewerId' in request && this.lastFrame && this.lastFrame.epoch === this.control.epoch && this.viewers.has(request.viewerId)
            ? { ...this.lastFrame, viewerId: request.viewerId } : undefined;
        return { state: this.state(), ...(frame ? { frame } : {}) };
    }

    private async captureFrame(signal?: AbortSignal): Promise<void> {
        this.assertReady(); const epoch = this.control.epoch;
        const capture = await this.cdp!.request('Page.captureScreenshot', { format: 'jpeg', quality: 55, captureBeyondViewport: false }, signal);
        if (epoch !== this.control.epoch || this.phase !== 'ready' || typeof capture.data !== 'string' || capture.data.length > 512 * 1024) return;
        this.lastFrame = { type: 'personal-computer-frame', data: capture.data, width: WIDTH, height: HEIGHT, sequence: ++this.sequence, epoch };
        for (const viewerId of this.viewers) { try { this.options.onFrame({ ...this.lastFrame, viewerId }); } catch {} }
    }

    private async refreshFrames(signal?: AbortSignal): Promise<void> {
        if (!this.cdp) return;
        await this.setCasting(false, signal);
        if (this.viewers.size) {
            await this.setCasting(true, signal);
            await this.captureFrame(signal);
        }
    }

    private setCasting(active: boolean, signal?: AbortSignal): Promise<void> {
        // Subscribe/reconnect/control transitions may arrive concurrently.
        // Chromium rejects a second start, so serialize and deduplicate writes.
        const update = async () => {
            signal?.throwIfAborted();
            const cdp = this.cdp;
            if (!cdp || this.casting === active) return;
            try {
                await cdp.request(active ? 'Page.startScreencast' : 'Page.stopScreencast', active
                    ? { format: 'jpeg', quality: 55, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 2 } : {}, signal);
            } catch (error) {
                // A cancelled/timed-out request may already have started the
                // cast. One uncancelled stop restores known state before retry.
                try {
                    await cdp.request('Page.stopScreencast');
                    if (this.cdp === cdp) this.casting = false;
                } catch {
                    if (this.cdp === cdp) {
                        cdp.close(); this.cdp = null; this.casting = false; this.lastFrame = null;
                        this.chromeUseBound = false; this.browserTarget = null; this.phase = 'error';
                        this.error = 'Computer view could not be confirmed; reopen to reconnect'; this.changes.emit('control');
                    }
                }
                throw error;
            }
            if (this.cdp === cdp) this.casting = active;
        };
        const operation = this.castingOperation.then(update, update);
        this.castingOperation = operation.catch(() => {});
        return operation;
    }

    private assertReady(): void { if (this.disposed || this.stopping || this.phase !== 'ready' || !this.cdp) throw new Error('Start the Personal computer before using it'); }

    async waitForAgentControl(signal: AbortSignal): Promise<void> {
        signal.throwIfAborted();
        if (this.disposed) throw new Error('Personal computer runtime is disposed');
        if (!this.control.viewer && !this.controlTransition) return;
        await new Promise<void>((resolve, reject) => {
            const finish = () => { this.changes.off('control', changed); signal.removeEventListener('abort', abort); };
            const abort = () => { finish(); reject(new Error('Personal task cancelled')); };
            const changed = () => {
                if (this.phase === 'stopped' || this.phase === 'error') { finish(); reject(new Error('Personal computer is unavailable')); }
                else if (!this.control.viewer && !this.controlTransition) { finish(); resolve(); }
            };
            this.changes.on('control', changed); signal.addEventListener('abort', abort, { once: true });
            changed();
        });
    }

    private agentAction<T>(signal: AbortSignal, action: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
        const epoch = this.control.epoch;
        const run = async () => {
            this.assertReady();
            if (this.controlTransition) throw new Error('Computer control transition is in progress');
            this.control.assertAgent(epoch); signal.throwIfAborted();
            const controller = new AbortController(); this.controllers.add(controller);
            const combined = AbortSignal.any([signal, controller.signal]);
            const check = () => { combined.throwIfAborted(); this.control.assertAgent(epoch); };
            try { const result = await action(combined, check); check(); return result; }
            finally { this.controllers.delete(controller); }
        };
        const operation = this.operation.then(run, run);
        this.operation = operation.catch(() => {});
        return operation;
    }

    async execute(input: PersonalComputerInput, signal: AbortSignal): Promise<unknown> {
        return this.agentAction(signal, async (current, check) => {
            const commands: string[][] = [];
            if (input.kind === 'element') {
                const ref = input.ref.startsWith('@') ? input.ref : `@${input.ref}`;
                if (!/^@e[0-9]+$/.test(ref)) throw new Error('Use an element reference from the latest chrome-use snapshot');
                const value = input.value;
                if (value !== undefined && value.startsWith('-')) throw new Error('This value cannot be passed as a browser CLI option');
                if (input.action === 'press') {
                    if (!value || !/^(?:Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space|Control\+a)$/.test(value)) throw new Error('Unsupported element key');
                    commands.push(['press', value, '--selector', ref, '--observe']);
                } else if (input.action === 'click' || input.action === 'hover') commands.push([input.action, ref, '--observe']);
                else {
                    if (value === undefined) throw new Error('This element action needs a value');
                    commands.push([input.action, ref, value, '--observe']);
                }
            } else if (input.kind === 'navigate') commands.push(['navigate', browserUrl(input.url)]);
            else if (input.kind === 'text') {
                if (input.text.startsWith('-')) throw new Error('This value cannot be passed as a browser CLI option');
                commands.push(['keyboard', 'inserttext', input.text]);
            } else if (input.kind === 'key') commands.push(['press', input.key === 'SelectAll' ? 'Control+a' : input.key]);
            else if (input.kind === 'scroll') commands.push(['scroll', input.deltaY < 0 ? 'up' : 'down', String(Math.abs(input.deltaY))]);
            else throw new Error('Agent coordinate clicks are unavailable; use a chrome-use semantic element reference');
            let action: unknown;
            for (const command of commands) { check(); action = await this.chromeUse(command, current); }
            check(); const snapshot = await this.chromeUse(['snapshot', '-i', '--max-bytes', '16000'], current); check();
            return { action, snapshot, ...(await this.observe(current) as object) };
        });
    }

    private async input(input: PersonalComputerInput, signal: AbortSignal | undefined, check: () => void): Promise<void> {
        check(); const cdp = this.cdp!;
        switch (input.kind) {
            case 'navigate': await cdp.request('Page.navigate', { url: browserUrl(input.url) }, signal); break;
            case 'click':
                if (input.x >= WIDTH || input.y >= HEIGHT) throw new Error('Input is outside the computer viewport');
                await cdp.request('Input.dispatchMouseEvent', { type: 'mousePressed', x: input.x, y: input.y, button: 'left', clickCount: 1 }, signal); check();
                await cdp.request('Input.dispatchMouseEvent', { type: 'mouseReleased', x: input.x, y: input.y, button: 'left', clickCount: 1 }, signal); break;
            case 'scroll':
                if (input.x >= WIDTH || input.y >= HEIGHT) throw new Error('Input is outside the computer viewport');
                await cdp.request('Input.dispatchMouseEvent', { type: 'mouseWheel', x: input.x, y: input.y, deltaX: 0, deltaY: input.deltaY }, signal); break;
            case 'text': await cdp.request('Input.insertText', { text: input.text }, signal); break;
            case 'key': {
                const keys: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
                    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
                    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
                    Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 }, Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
                    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 }, ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
                    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
                    SelectAll: { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 },
                };
                const key = keys[input.key]; if (!key) throw new Error('Unsupported key');
                const modifiers = input.key === 'SelectAll' ? 2 : 0;
                await cdp.request('Input.dispatchKeyEvent', { type: 'keyDown', ...key, modifiers }, signal); check();
                await cdp.request('Input.dispatchKeyEvent', { type: 'keyUp', ...key, modifiers }, signal); break;
            }
            case 'element': throw new Error('Human input uses the displayed browser viewport; semantic element actions belong to the agent adapter');
        }
        check(); await this.observe(signal);
    }

    private async observe(signal?: AbortSignal): Promise<unknown> {
        this.assertReady();
        // Fixed observation only; never accept model-provided JavaScript.
        const result = await this.cdp!.request('Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,title:document.title})', returnByValue: true }, signal);
        try { const value = JSON.parse(result.result?.value ?? '{}'); this.url = String(value.url ?? '').slice(0, 4096); this.title = String(value.title ?? '').slice(0, 500); } catch { /* Keep last known navigation identity. */ }
        return { url: this.url, title: this.title, width: WIDTH, height: HEIGHT };
    }

    async snapshot(signal: AbortSignal): Promise<unknown> {
        return this.agentAction(signal, async current => ({ ...(await this.observe(current) as object),
            snapshot: await this.chromeUse(['snapshot', '-i', '--max-bytes', '16000'], current) }));
    }

    private async chromeUse(args: string[], signal: AbortSignal): Promise<unknown> {
        this.assertReady();
        const invoke = async (command: string[]) => {
            const output = await this.docker(['exec', '--env', 'HOME=/profile/controller', '--env', 'DISPLAY=:99',
                '--env', 'CHROME_USE_NO_UPDATE_CHECK=1', '--env', 'USE_NO_UPDATE_CHECK=1',
                '--env', 'AGENT_BROWSER_NO_AUTO_RECONNECT=1',
                '--env', 'NO_PROXY=127.0.0.1,localhost,::1', '--env', 'no_proxy=127.0.0.1,localhost,::1',
                this.name, '/usr/local/bin/chrome-use',
                '--session', 'paws-personal', '--cdp', '9222', ...command, '--json'], signal, undefined, 60_000);
            let parsed: any;
            try { parsed = JSON.parse(output.trim()); } catch { throw new Error('chrome-use returned invalid structured output'); }
            if (parsed.success === false || parsed.ok === false) throw new Error(String(parsed.error?.message ?? parsed.error ?? 'chrome-use could not complete this action').slice(0, 500));
            return parsed;
        };
        try {
            if (!this.chromeUseBound) {
                if (!this.browserTarget) throw new Error('Computer page identity is missing');
                await invoke(['connect', '9222']);
                const adopted = await invoke(['tab', 'adopt', this.browserTarget]);
                if (adopted.data?.targetId !== this.browserTarget || adopted.data?.verified !== 'confirmed') throw new Error('chrome-use did not confirm the displayed computer page');
                this.chromeUseBound = true;
            }
            const assertDisplayedPage = async () => {
                const listed = await invoke(['tab', 'list', '--full']);
                const active = listed.data?.tabs?.find((tab: any) => tab.active);
                if (active?.targetId !== this.browserTarget) throw new Error('The browser opened another tab; switch back to the displayed computer page before continuing');
            };
            await assertDisplayedPage();
            const result = await invoke(args);
            await assertDisplayedPage();
            return result;
        }
        catch (error) {
            // A timed-out CLI can leave its daemon processing an unknown action.
            // Revoke it before accepting human control or another action.
            await this.docker(['exec', this.name, 'node', '/opt/paws/kill-chrome-use.mjs']).catch(() => {});
            this.chromeUseBound = false;
            throw error;
        }
    }

    private async waitBrowserReady(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        const info = await this.inspect('container', this.name);
        if (!info) throw new Error('Computer browser container is missing');
        this.assertOwned(info);
        await new Promise<void>((resolve, reject) => {
            const logs = spawn('docker', ['logs', '--follow', '--since', info.State.StartedAt, this.name], { stdio: ['ignore', 'pipe', 'pipe'] });
            let ended = false, tail = '';
            const finish = (error?: Error) => { if (ended) return; ended = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); logs.kill('SIGKILL'); error ? reject(error) : resolve(); };
            const abort = () => finish(new Error('Computer start cancelled'));
            const timer = setTimeout(() => finish(new Error('Computer browser did not report ready')), 60_000);
            const read = (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-8000); if (tail.includes('DevTools listening on ws://')) finish(); };
            logs.stdout.on('data', read); logs.stderr.on('data', read);
            logs.once('error', error => finish(error)); logs.once('close', () => { if (!ended) finish(new Error('Computer stopped before reporting ready')); });
            signal?.addEventListener('abort', abort, { once: true });
        });
    }

    private async job(args: string[], signal: AbortSignal, stdin?: string): Promise<string> {
        const name = `${this.name}-task-${randomUUID().slice(0, 12)}`;
        this.tasks.add(name);
        const abort = () => { void this.docker(['rm', '-f', name]).catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        try {
            signal.throwIfAborted();
            return await this.docker([...this.commonRun(name, this.jobsNetwork), '--rm', '-i',
                '--mount', `type=volume,src=${this.workspace},dst=/workspace`, this.image, ...args], signal, stdin, 65_000);
        } finally {
            signal.removeEventListener('abort', abort);
            await this.docker(['rm', '-f', name]).catch(() => {});
            this.tasks.delete(name);
        }
    }

    async readFile(path: string, signal: AbortSignal): Promise<string> {
        const bounded = workspacePath(path);
        return this.agentAction(signal, async current => {
            const result = JSON.parse(await this.job(['node', '/opt/paws/workspace.mjs'], current, JSON.stringify({ action: 'read', path: bounded })));
            return result.content;
        });
    }

    async writeFile(path: string, content: string, signal: AbortSignal): Promise<unknown> {
        const bounded = workspacePath(path);
        if (Buffer.byteLength(content) > 256 * 1024) throw new Error('File exceeds 256 KiB');
        return this.agentAction(signal, async current => JSON.parse(await this.job(['node', '/opt/paws/workspace.mjs'], current, JSON.stringify({ action: 'write', path: bounded, content }))));
    }

    async runCommand(command: string, signal: AbortSignal): Promise<unknown> {
        if (!command || command.length > 12000) throw new Error('Invalid computer command');
        return this.agentAction(signal, async current => JSON.parse(await this.job(['node', '/opt/paws/command.mjs'], current, JSON.stringify({ command }))));
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true; this.phase = 'stopped'; this.control.epoch++;
        if (this.lockNonce) this.persistControl(); else this.changes.emit('control');
        const wasStarting = !!this.starting;
        this.lifecycleAbort?.abort();
        await this.starting?.catch(() => {});
        await this.attaching?.catch(() => {});
        await this.stopping?.catch(() => {});
        await this.controlTransition?.catch(() => {});
        await this.abortActions();
        if (wasStarting) for (const name of [this.name, this.proxy]) {
            const info = await this.inspect('container', name); if (info) { this.assertOwned(info); await this.docker(['stop', '--time=3', name]).catch(() => {}); }
        }
        this.viewers.clear(); this.cdp?.close(); this.cdp = null; this.casting = false;
        await this.tunnel?.close(); this.tunnel = null;
        this.phase = 'stopped'; this.changes.emit('control');
        if (this.lockNonce) {
            try { const file = join(this.home, 'computer-runtime.lock'); if (JSON.parse(readFileSync(file, 'utf8')).nonce === this.lockNonce) rmSync(file); } catch { /* Leave unrelated ownership records alone. */ }
            this.lockNonce = null;
        }
    }
}
