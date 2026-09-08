import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { expect, it } from 'vitest';
import { PawsAgentClient } from './PawsAgentClient';

it('delivers the initial synchronized snapshot before reporting ready', async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
        paths.push(request.url!);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(request.url === '/v1/machines' ? [] : { sessions: [] }));
    });
    const io = new Server(server, { path: '/v1/updates', transports: ['websocket'] });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const client = new PawsAgentClient({
        serverUrl: `http://127.0.0.1:${address.port}`,
        credentials: {
            getCredentials: async () => ({ token: 'fixture', secret: new Uint8Array(32), contentKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) } }),
            setCredentials: async () => {}, clearCredentials: async () => {},
        },
    });
    const events: unknown[] = [];
    client.subscribe(event => events.push(event));
    try {
        await client.connect();
        expect(events).toEqual([
            { type: 'connection', state: 'connecting' },
            { type: 'connection', state: 'syncing' },
            { type: 'snapshot', machines: [], sessions: [] },
            { type: 'connection', state: 'ready' },
        ]);
        expect(paths.sort()).toEqual(['/v1/machines', '/v1/sessions']);
    } finally {
        await client.dispose();
        await new Promise<void>(resolve => io.close(() => resolve()));
    }
});
