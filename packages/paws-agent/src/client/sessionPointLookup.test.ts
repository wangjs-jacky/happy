import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PawsAgentClient } from './PawsAgentClient';

let client: PawsAgentClient;
let io: Server;
let requests: string[];
let archived: boolean;
const record = {
    id: 'point-session', seq: 1, createdAt: 1, updatedAt: 1,
    active: true, activeAt: 1, metadata: null, metadataVersion: 1,
    agentState: null, agentStateVersion: 1, dataEncryptionKey: null,
};

beforeEach(async () => {
    requests = [];
    archived = false;
    const server = createServer((request, response) => {
        const path = request.url!;
        requests.push(`${request.method} ${path}`);
        response.setHeader('Content-Type', 'application/json');
        if (path === '/v1/machines') response.end('[]');
        else if (path === '/v1/sessions') response.end('{"sessions":[]}');
        else if (path === '/v2/sessions/point-session' || path === '/v2/sessions/wrong-session') response.end(JSON.stringify({ session: { ...record, active: !archived } }));
        else if (path.startsWith('/v3/sessions/point-session/messages')) response.end('{"messages":[]}');
        else { response.statusCode = 404; response.end('{"error":"Session not found"}'); }
    });
    io = new Server(server, { path: '/v1/updates', transports: ['websocket'] });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    client = new PawsAgentClient({ serverUrl: `http://127.0.0.1:${port}`, credentials: {
        getCredentials: async () => ({ token: 'fixture', secret: new Uint8Array(32), contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) } }),
        setCredentials: async () => {}, clearCredentials: async () => {},
    } });
    await client.connect();
    requests.length = 0;
});

afterEach(async () => {
    await client.dispose();
    await new Promise<void>(resolve => io.close(() => resolve()));
});

it('loads a session outside the initial list using a point lookup', async () => {
    expect(await client.sessions.get('point-session')).toMatchObject({ id: 'point-session', active: true });
    expect(requests).toEqual(['GET /v2/sessions/point-session']);
});

it('does not fall back to downloading all sessions when a target is missing', async () => {
    await expect(client.sessions.get('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(requests).toEqual(['GET /v2/sessions/missing']);
});

it('rejects a mismatched point response instead of attaching a different session', async () => {
    await expect(client.sessions.get('wrong-session')).rejects.toMatchObject({ code: 'PROTOCOL_UNSUPPORTED' });
});

it('checks fresh session activity before sending instead of trusting the cache', async () => {
    await client.sessions.get('point-session');
    archived = true;
    await expect(client.messages.send({ sessionId: 'point-session', text: 'hello' })).rejects.toMatchObject({ code: 'SESSION_ARCHIVED' });
    expect(requests).toEqual(['GET /v2/sessions/point-session', 'GET /v2/sessions/point-session']);
});

it('updates only the session named by a realtime event', async () => {
    const events: any[] = [];
    client.subscribe(event => events.push(event));
    io.emit('update', { body: { t: 'update-session', id: 'point-session' } });
    await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: 'session', session: expect.objectContaining({ id: 'point-session' }) })));
    expect(requests).toEqual(['GET /v2/sessions/point-session']);
});

it('sends and reads messages without downloading the full session list again', async () => {
    await expect(client.messages.send({ sessionId: 'point-session', text: 'hello', localId: 'local-1' })).resolves.toMatchObject({ sessionId: 'point-session' });
    await expect(client.messages.history('point-session', { limit: 50 })).resolves.toEqual([]);
    expect(requests).toEqual([
        'GET /v2/sessions/point-session',
        'POST /v3/sessions/point-session/messages',
        'GET /v3/sessions/point-session/messages?before_seq=2147483647&limit=50',
    ]);
});
