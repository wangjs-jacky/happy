/** Tests native directory discovery through a local, read-only JSON-RPC fixture. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listCodexNativeModels, nativeCodexModelEnvironment } from './codexNativeModels';

const roots: string[] = [];
type AuditEvent =
    | { kind: 'spawn'; pid: number; argv: string[]; env: NodeJS.ProcessEnv }
    | { kind: 'request'; method: string };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(options: { fail?: string; repeatCursor?: boolean; empty?: boolean; malformed?: boolean; slowExit?: boolean } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'paws-native-models-'));
    roots.push(root);
    const binary = join(root, 'codex');
    const audit = join(root, 'audit.jsonl');
    const config = join(root, 'config.toml');
    const originalConfig = 'model_provider = "magpie"\nmodel = "DeepSeek-V4.1-Flash"\n';
    await writeFile(config, originalConfig);
    await writeFile(join(root, 'codex-code-mode-host'), '');
    await writeFile(binary, String.raw`#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
if (process.argv.includes('--version')) { console.log('codex-cli 0.159.3'); process.exit(0); }
const audit = ${JSON.stringify(audit)};
const options = ${JSON.stringify(options)};
if (options.slowExit) process.on('SIGTERM', () => setTimeout(() => process.exit(0), 300));
fs.appendFileSync(audit, JSON.stringify({kind:'spawn',pid:process.pid,argv:process.argv.slice(2),env:{
    CODEX_HOME:process.env.CODEX_HOME,OPENAI_API_KEY:process.env.OPENAI_API_KEY,OPENAI_BASE_URL:process.env.OPENAI_BASE_URL,
    HAPPY_CODEX_ACCOUNT_PROFILE_ID:process.env.HAPPY_CODEX_ACCOUNT_PROFILE_ID,
    HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION:process.env.HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION,
    HAPPY_CODEX_APP_SERVER_SOCKET:process.env.HAPPY_CODEX_APP_SERVER_SOCKET,
}})+'\n');
readline.createInterface({input:process.stdin}).on('line', line => {
    const request = JSON.parse(line);
    fs.appendFileSync(audit, JSON.stringify({kind:'request',...request})+'\n');
    if (request.id == null) return;
    if (request.method === options.fail) { console.log(JSON.stringify({id:request.id,error:{code:-32000,message:'provider-secret-test'}})); return; }
    let result = {};
    if (request.method === 'model/list') result = options.malformed ? {data:[{model:42}]} : options.empty ? {data:[],nextCursor:null} : request.params.cursor
        ? {data:[{id:'opaque-id-2',model:'magpie/Case-Sensitive',displayName:'Case-sensitive route',description:null}],nextCursor:options.repeatCursor?'page-2':null}
        : {data:[{id:'opaque-id',model:'DeepSeek-V4.1-Flash',displayName:'DeepSeek Flash',description:'Native configured route',hidden:false},
          {id:'hidden',model:'hidden-route',displayName:'Hidden',hidden:true}],nextCursor:'page-2'};
    else if (request.method !== 'initialize') { console.log(JSON.stringify({id:request.id,error:{code:-32601,message:'Only discovery is allowed'}})); return; }
    console.log(JSON.stringify({id:request.id,result}));
});
`, { mode: 0o700 });
    const env: NodeJS.ProcessEnv = { ...process.env, HAPPY_CODEX_PATH: binary, CODEX_HOME: root,
        OPENAI_API_KEY: 'fixture-only', OPENAI_BASE_URL: 'https://native.example' };
    delete env.HAPPY_CODEX_ACCOUNT_PROFILE_ID;
    delete env.HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION;
    return { root, env, originalConfig, config, events: async () => (await readFile(audit, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as AuditEvent) };
}

describe('native Codex model directory', () => {
    it('removes managed account markers and their isolated home without mutating the daemon environment', () => {
        const original = { CODEX_HOME: '/managed-account', HAPPY_CODEX_ACCOUNT_PROFILE_ID: 'profile-a',
            HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION: '3', HAPPY_CODEX_APP_SERVER_SOCKET: '/managed.sock',
            HAPPY_CODEX_APP_SERVER_MODE: 'shared', OPENAI_BASE_URL: 'https://native.example', OPENAI_API_KEY: 'native-secret' };
        const env = nativeCodexModelEnvironment(original);
        expect(env.CODEX_HOME).toBeUndefined();
        expect(env.HAPPY_CODEX_ACCOUNT_PROFILE_ID).toBeUndefined();
        expect(env.HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION).toBeUndefined();
        expect(env.HAPPY_CODEX_APP_SERVER_SOCKET).toBeUndefined();
        expect(env.HAPPY_CODEX_APP_SERVER_MODE).toBe('spawn');
        expect(env.OPENAI_BASE_URL).toBe(original.OPENAI_BASE_URL);
        expect(env.OPENAI_API_KEY).toBe(original.OPENAI_API_KEY);
        expect(original.CODEX_HOME).toBe('/managed-account');
        expect(original.HAPPY_CODEX_ACCOUNT_PROFILE_ID).toBe('profile-a');
    });

    it('preserves a native custom home and provider environment', () => {
        const env = nativeCodexModelEnvironment({ CODEX_HOME: '/native-custom-home', OPENAI_API_KEY: 'native-secret' });
        expect(env.CODEX_HOME).toBe('/native-custom-home');
        expect(env.OPENAI_API_KEY).toBe('native-secret');
    });

    it('treats a credential-version marker alone as a managed home', () => {
        expect(nativeCodexModelEnvironment({ CODEX_HOME: '/managed-account', HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION: '3' }).CODEX_HOME).toBeUndefined();
    });

    it('maps exact launch IDs and labels across pages, closes the process and only sends discovery requests', async () => {
        const f = await fixture();
        const result = await listCodexNativeModels(f.env);
        expect(result).toEqual({ type: 'success', models: [
            { code: 'DeepSeek-V4.1-Flash', value: 'DeepSeek Flash', description: 'Native configured route' },
            { code: 'magpie/Case-Sensitive', value: 'Case-sensitive route', description: null },
        ] });
        const events = await f.events();
        const spawned = events.find(event => event.kind === 'spawn')!;
        expect(spawned.env.CODEX_HOME).toBe(f.root);
        expect(events.filter(event => event.kind === 'request').map(event => event.method)).toEqual(['initialize', 'initialized', 'model/list', 'model/list']);
        expect(() => process.kill(spawned.pid, 0)).toThrow();
        expect(await readFile(f.config, 'utf8')).toBe(f.originalConfig);
    });

    it('never inherits managed account overrides or a bound shared worker', async () => {
        const f = await fixture();
        const result = await listCodexNativeModels({ ...f.env, HAPPY_CODEX_ACCOUNT_PROFILE_ID: 'profile-a',
            HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION: '3', HAPPY_CODEX_APP_SERVER_MODE: 'shared', HAPPY_CODEX_APP_SERVER_SOCKET: '/bound-worker.sock' });
        expect(result.type).toBe('success');
        const spawned = (await f.events()).find(event => event.kind === 'spawn')!;
        expect(spawned.env.CODEX_HOME).toBeUndefined();
        expect(spawned.env.HAPPY_CODEX_ACCOUNT_PROFILE_ID).toBeUndefined();
        expect(spawned.env.HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION).toBeUndefined();
        expect(spawned.env.HAPPY_CODEX_APP_SERVER_SOCKET).toBeUndefined();
        expect(spawned.argv.join(' ')).not.toContain('paws_openai_http');
    });

    it('closes on model/list failure and does not return provider errors or secrets', async () => {
        const f = await fixture({ fail: 'model/list' });
        const result = await listCodexNativeModels(f.env);
        expect(result).toEqual({ type: 'error', errorMessage: 'Unable to read native Codex models. Check the machine’s native Codex connection and try again.' });
        const events = await f.events();
        expect(() => process.kill(events.find(event => event.kind === 'spawn')!.pid, 0)).toThrow();
        expect(events.some(event => event.kind === 'request' && /^(turn|thread|config)\//.test(event.method))).toBe(false);
    });

    it('waits for process exit when initialization fails before the directory request', async () => {
        const f = await fixture({ fail: 'initialize', slowExit: true });
        expect((await listCodexNativeModels(f.env)).type).toBe('error');
        const events = await f.events();
        const spawned = events.find(event => event.kind === 'spawn')!;
        expect(() => process.kill(spawned.pid, 0)).toThrow();
        expect(events.filter(event => event.kind === 'request').map(event => event.method)).toEqual(['initialize']);
    });

    it.each([{ repeatCursor: true }, { empty: true }, { malformed: true }])('rejects an invalid directory instead of offering guessed models: %j', async options => {
        const f = await fixture(options);
        expect((await listCodexNativeModels(f.env)).type).toBe('error');
        const spawned = (await f.events()).find(event => event.kind === 'spawn')!;
        expect(() => process.kill(spawned.pid, 0)).toThrow();
    });
});
