import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import environmentHelpers from '../../../../../environments/environments.ts';
const { createEnvironment, getEnvironmentConfig, setEnvironmentTemplate, startEnvironmentServices, seedEnvironment, startEnvironmentWeb, stopEnvironment, removeEnvironment } = environmentHelpers;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const output = path.join(root, 'packages/happy-app/test-results/personal-agent');
await fs.mkdir(output, { recursive: true });
delete process.env.TSX_TSCONFIG_PATH;
process.env.HAPPY_E2E_DISABLE_WATCHMAN = '1';
process.env.S3_HOST = '';
process.env.NO_PROXY = [process.env.NO_PROXY, 'localhost', '127.0.0.1', '::1'].filter(Boolean).join(',');
const log = console.log;
console.log = (...args) => log(...args.map(value => typeof value === 'string' && value.includes('Auth URL:') ? 'Auth URL: saved privately' : value));
let environment, machineSocket, controller, runtime;
const sessions = new Map();
const computerEnabled = process.env.PAWS_PERSONAL_FIXTURE_COMPUTER === '1';
// Only counts are exported: no credentials, request arguments or message text.
const metrics = { spawns: 0, resumes: 0, messages: 0, aborts: 0, approvals: 0, denials: 0, completed: 0 };
let closing = false;

async function main() {
    environment = await createEnvironment({ noSwitch: true });
    setEnvironmentTemplate(environment, 'authenticated-empty');
    await startEnvironmentServices(environment, { startWeb: false });
    await seedEnvironment(environment, { startDaemon: false });
    const config = getEnvironmentConfig(environment);
    const directory = path.join(root, 'environments/data/envs', environment);
    const auth = JSON.parse(await fs.readFile(path.join(directory, 'cli/home/access.key'), 'utf8'));
    const key = new Uint8Array(Buffer.from(auth.secret, 'base64'));
    const serverUrl = `http://localhost:${config.serverPort}`;
    const headers = { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
    process.env.HAPPY_SERVER_URL = serverUrl;
    process.env.HAPPY_HOME_DIR = path.join(directory, 'cli/home');
    const encryption = await import('../../../../happy-cli/src/api/encryption.ts');
    const { ApiSessionClient } = await import('../../../../happy-cli/src/api/apiSession.ts');
    const { RpcHandlerManager } = await import('../../../../happy-cli/src/api/rpc/RpcHandlerManager.ts');
    const { createEnvelope } = await import('@slopus/happy-wire');
    const require = createRequire(path.join(root, 'packages/happy-cli/package.json'));
    const { io } = require('socket.io-client');
    const encode = value => encryption.encodeBase64(encryption.encryptLegacy(value, key));
    const settings = await (await fetch(`${serverUrl}/v1/account/settings`, { headers })).json();
    assert((await fetch(`${serverUrl}/v1/account/settings`, { method: 'POST', headers, body: JSON.stringify({ expectedVersion: settings.settingsVersion, settings: encode({ preferredLanguage: 'zh-Hans' }) }) })).ok);
    const machineId = randomUUID();
    const project = path.join(directory, 'cli/home/personal-agent/workspace');
    await fs.mkdir(project, { recursive: true });
    const machineMetadata = { host: 'personal-agent-fixture.local', displayName: 'Personal 隔离验收', platform: 'darwin', happyCliVersion: 'fixture', homeDir: directory, happyHomeDir: path.join(directory, 'cli/home'), cliAvailability: { personal: true, personalComputer: computerEnabled, codex: true, claude: false, gemini: false, openclaw: false, detectedAt: Date.now() } };
    assert((await fetch(`${serverUrl}/v1/machines`, { method: 'POST', headers, body: JSON.stringify({ id: machineId, metadata: encode(machineMetadata), dataEncryptionKey: null }) })).ok);

    function send(slot, body) {
        slot.client.sendSessionProtocolMessage(createEnvelope('agent', body, slot.turn ? { turn: slot.turn } : {}));
    }
    function start(slot) {
        assert(slot.online, 'Session is offline');
        assert(!slot.turn, 'A fixture turn is already running');
        slot.turn = randomUUID();
        send(slot, { t: 'turn-start' });
        slot.client.keepAlive(true, 'remote');
    }
    async function clearRequests(slot, status = 'canceled') {
        slot.pending.clear();
        await slot.client.updateAgentState(state => {
            const completedRequests = { ...state.completedRequests };
            for (const [id, request] of Object.entries(state.requests ?? {})) completedRequests[id] = { ...request, completedAt: Date.now(), status };
            return { ...state, requests: {}, completedRequests };
        });
    }
    async function finish(slot, status = 'completed', message) {
        if (!slot.turn) return;
        if (message) send(slot, { t: 'text', text: message });
        send(slot, { t: 'turn-end', status });
        slot.turn = null;
        slot.client.keepAlive(false, 'remote');
        slot.client.sendSessionEvent({ type: 'ready' });
        await slot.client.flush();
        metrics.completed++;
    }
    async function createSession(name = 'Personal 隔离交互验收', target = computerEnabled ? 'docker' : 'local') {
        assert(target === 'local' || (computerEnabled && target === 'docker'), 'Unsupported execution target');
        const metadata = { path: project, homeDir: directory, host: machineMetadata.host, name, machineId, flavor: 'personal', personalExecutionTarget: target, personalComputer: target === 'docker', lifecycleState: 'running', startedBy: 'terminal', models: [{ code: 'fixture-no-model', value: '隔离执行器（不调用模型）' }], currentModelCode: 'fixture-no-model', currentOperatingModeCode: 'default', operatingModes: [{ code: 'default', value: 'Confirm actions' }], slashCommands: ['skills', 'status'] };
        const agentState = { requests: {}, completedRequests: {}, turnStatus: { status: 'completed', turnId: randomUUID(), updatedAt: Date.now() } };
        const response = await fetch(`${serverUrl}/v1/sessions`, { method: 'POST', headers, body: JSON.stringify({ tag: randomUUID(), metadata: encode(metadata), agentState: encode(agentState), dataEncryptionKey: null }) });
        assert(response.ok); const session = (await response.json()).session;
        const client = new ApiSessionClient(auth.token, { id: session.id, seq: session.seq, encryptionKey: key, encryptionVariant: 'legacy', metadata, metadataVersion: session.metadataVersion, agentState, agentStateVersion: session.agentStateVersion });
        const slot = { id: session.id, client, online: true, turn: null, pending: new Map(), computer: undefined };
        if (target === 'docker') {
            const { PersonalComputer } = await import('../../../../happy-cli/src/personal/computer/index.ts');
            const { PersonalComputerRequestSchema } = await import('@slopus/happy-wire');
            slot.computer = new PersonalComputer({ home: path.join(output, 'computers', session.id), onFrame: frame => client.sendPersonalComputerFrame(frame) });
            client.rpcHandlerManager.registerHandler('personal-computer', request => slot.computer.request(PersonalComputerRequestSchema.parse(request)));
        }
        sessions.set(session.id, slot);
        client.rpcHandlerManager.registerHandler('fixtureReady', async () => ({ ready: true }));
        await once(client.socket, 'rpc-registered', e => e.method === `${session.id}:fixtureReady`);
        client.rpcHandlerManager.registerHandler('abort', async () => {
            metrics.aborts++;
            await clearRequests(slot);
            await finish(slot, 'cancelled');
            return { success: true };
        });
        client.rpcHandlerManager.registerHandler('permission', async input => {
            assert(slot.online, 'Session is offline');
            const pending = slot.pending.get(input.id);
            if (!pending) return;
            // Match Personal single-action semantics; never accept an expanded grant.
            assert(!input.mode && !input.allowedTools && input.decision !== 'approved_for_session', 'Only a single-action decision is supported');
            slot.pending.delete(input.id);
            const approved = input.approved === true;
            await client.updateAgentState(state => {
                const request = state.requests?.[input.id];
                const { [input.id]: _, ...remaining } = state.requests ?? {};
                return { ...state, requests: remaining, completedRequests: { ...state.completedRequests, [input.id]: { ...request, completedAt: Date.now(), status: approved ? 'approved' : 'denied', decision: approved ? 'approved' : 'denied' } } };
            });
            if (pending.history) send(slot, { t: 'tool-call-end', call: input.id, status: approved ? 'completed' : 'failed', ...(approved ? {} : { error: { summary: '隔离验收：本次操作已拒绝，未执行命令。' } }) });
            metrics[approved ? 'approvals' : 'denials']++;
            await finish(slot, 'completed', approved ? '单次允许已收到。这是隔离权限链路验收，未执行真实命令。' : '本次拒绝已收到。这是隔离权限链路验收，未执行真实命令。');
            return { success: true };
        });
        client.keepAlive(false, 'remote');
        // Transport heartbeat only: no business queries, scans, timers or model calls.
        client.socket.io.engine.on('packet', packet => { if (packet.type === 'ping' && slot.online) client.keepAlive(!!slot.turn, 'remote'); });
        client.onUserMessage(() => {
            metrics.messages++;
            if (!slot.online || slot.turn) return;
            start(slot);
            void finish(slot, 'completed', '已收到这条消息。**Personal 隔离交互验收通过传输层**：消息来自真实加密链路；回复由测试执行器生成，没有调用外部模型。').catch(error => { console.error('Fixture reply failed:', error.message); });
        });
        start(slot);
        await finish(slot, 'completed', '你好，我是 Paws。此处运行 **Personal 隔离验收**，可以测试发送、草稿、资料、工具确认、停止和重连；不会操作真实账号、执行命令或调用外部模型。');
        return session.id;
    }
    const manager = new RpcHandlerManager({ scopePrefix: machineId, encryptionKey: key, encryptionVariant: 'legacy' });
    manager.registerHandler('browseDirectory', async () => ({ success: true, path: project, entries: [], parentPath: directory }));
    manager.registerHandler('get-path-suggestions', async () => ({ suggestions: [project] }));
    manager.registerHandler('goalProjects', async () => ({ success: true, projects: [] }));
    manager.registerHandler('spawn-happy-session', async input => {
        assert.equal(input.agent, 'personal');
        assert.equal(input.directory, project);
        const sessionId = await createSession(undefined, input.environmentVariables?.PAWS_PERSONAL_EXECUTION_TARGET ?? 'local');
        metrics.spawns++;
        return { type: 'success', sessionId };
    });
    manager.registerHandler('resume-happy-session', async input => {
        const slot = sessions.get(input.sessionId);
        assert(slot, 'Unknown fixture session');
        slot.online = true;
        await slot.client.updateMetadataAndAwait(metadata => ({ ...metadata, lifecycleState: 'running', lifecycleStateSince: Date.now() }));
        slot.client.keepAlive(!!slot.turn, 'remote');
        metrics.resumes++;
        return { type: 'success', sessionId: slot.id };
    });
    machineSocket = io(serverUrl, { path: '/v1/updates', transports: ['websocket'], reconnection: false, auth: { token: auth.token, clientType: 'machine-scoped', machineId } });
    machineSocket.on('rpc-request', async (data, callback) => callback(await manager.handleRequest(data)));
    await once(machineSocket, 'connect');
    manager.onSocketConnect(machineSocket);
    await once(machineSocket, 'rpc-registered', event => event.method === `${machineId}:spawn-happy-session`);
    machineSocket.emit('machine-alive', { machineId, time: Date.now() });
    machineSocket.io.engine.on('packet', packet => { if (packet.type === 'ping') machineSocket.emit('machine-alive', { machineId, time: Date.now() }); });
    const sessionId = await createSession(undefined, process.env.PAWS_PERSONAL_FIXTURE_INITIAL_TARGET ?? (computerEnabled ? 'docker' : 'local'));
    runtime = { environment, pid: process.pid, serverUrl, webUrl: `http://localhost:${config.expoPort}`, sessionId, machineId, authUrlFile: path.join(output, 'auth-url.txt'), boundaries: { app: 'full App', server: 'isolated PGlite', transport: 'real encrypted sockets/RPC/messages', executor: 'text and approvals stubbed; no daemon, model or production access', computer: computerEnabled ? 'real isolated Docker/chrome-use runtime, explicit start only' : 'disabled', production: false } };
    await fs.writeFile(runtime.authUrlFile, config.authenticatedWebUrl, { mode: 0o600 });
    controller = createServer(async (request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        try {
            const url = new URL(request.url, 'http://127.0.0.1');
            if (request.method === 'GET' && url.pathname === '/runtime') return response.end(JSON.stringify(runtime));
            if (request.method === 'GET' && url.pathname === '/metrics') return response.end(JSON.stringify(metrics));
            if (request.method === 'POST' && url.pathname === '/shutdown') { response.end('{"stopping":true}'); setImmediate(() => { void cleanup(); }); return; }
            if (request.method !== 'POST') { response.writeHead(405); return response.end('{}'); }
            const slot = sessions.get(url.searchParams.get('sessionId') || runtime.sessionId);
            assert(slot, 'Unknown fixture session');
            if (url.pathname === '/running') {
                start(slot); await slot.client.flush();
                return response.end('{"running":true}');
            }
            if (url.pathname === '/pending') {
                if (!slot.turn) start(slot);
                assert.equal(slot.pending.size, 0, 'A permission is already pending');
                const id = randomUUID(), history = url.searchParams.get('history') === '1';
                const arguments_ = { command: 'printf "Personal isolated acceptance\\n"', description: '隔离验收：只展示命令，不执行' };
                slot.pending.set(id, { history });
                if (history) send(slot, { t: 'tool-call-start', call: id, name: 'run_command', title: '确认隔离验收动作', description: '隔离验收：只展示命令，不执行', args: arguments_ });
                await slot.client.updateAgentState(state => ({ ...state, requests: { ...state.requests, [id]: { tool: 'run_command', arguments: arguments_, createdAt: Date.now() } } }));
                await slot.client.flush();
                return response.end('{"pending":true}');
            }
            if (url.pathname === '/complete') {
                await clearRequests(slot); await finish(slot, 'completed', '隔离执行状态已完成，未执行外部动作。');
                return response.end('{"completed":true}');
            }
            if (url.pathname === '/offline') { slot.online = false; slot.client.sendSessionDeath(); return response.end('{"offline":true}'); }
            if (url.pathname === '/online') { slot.online = true; slot.client.keepAlive(!!slot.turn, 'remote'); return response.end('{"online":true}'); }
            response.writeHead(404); response.end('{}');
        } catch (error) { response.writeHead(409); response.end(JSON.stringify({ error: error.message })); }
    });
    await new Promise(resolve => controller.listen(0, '127.0.0.1', resolve));
    runtime.controllerUrl = `http://127.0.0.1:${controller.address().port}`;
    await fs.writeFile(path.join(output, 'runtime.json'), JSON.stringify(runtime, null, 2));
    await startEnvironmentWeb(environment, { warmBundle: true });
    log(JSON.stringify({ ready: true, ...runtime }));
}
function once(emitter, event, predicate = () => true) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { emitter.off(event, listener); reject(new Error(`Timeout ${event}`)); }, 30000);
        const listener = value => { if (!predicate(value)) return; clearTimeout(timer); emitter.off(event, listener); resolve(value); };
        emitter.on(event, listener);
    });
}
async function cleanup(code = 0) {
    if (closing) return;
    closing = true;
    for (const slot of sessions.values()) { slot.online = false; slot.client.sendSessionDeath(); await slot.computer?.dispose(); await slot.client.close(); }
    machineSocket?.disconnect(); controller?.close();
    if (environment) { stopEnvironment(environment); removeEnvironment(environment); }
    process.exit(code);
}
process.on('SIGINT', () => { void cleanup(); });
process.on('SIGTERM', () => { void cleanup(); });
main().catch(error => { console.error(error); void cleanup(1); });
