import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ComputerCdp } from './cdp';

const servers: WebSocketServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); } });

async function endpoint() {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('No test endpoint');
    return { server, url: `ws://127.0.0.1:${address.port}/devtools/page/fixture` };
}

describe('Private computer protocol transport', () => {
    it('rejects a nonloopback or credential-bearing endpoint before connecting', async () => {
        await expect(ComputerCdp.connect('ws://example.com:9222/')).rejects.toThrow('loopback');
        await expect(ComputerCdp.connect('ws://user:secret@127.0.0.1:9222/')).rejects.toThrow('loopback');
    });

    it('correlates replies and dispatches event-driven frames without querying state', async () => {
        const { server, url } = await endpoint();
        server.on('connection', socket => socket.on('message', bytes => {
            const request = JSON.parse(bytes.toString());
            socket.send(JSON.stringify({ id: request.id, result: { ready: true } }));
            socket.send(JSON.stringify({ method: 'Page.screencastFrame', params: { data: 'frame', sessionId: 3 } }));
        }));
        const client = await ComputerCdp.connect(url);
        const frame = new Promise(resolve => client.on('Page.screencastFrame', resolve));
        await expect(client.request('Page.enable')).resolves.toEqual({ ready: true });
        await expect(frame).resolves.toEqual({ data: 'frame', sessionId: 3 });
        client.close();
    });

    it('rejects a pending command when its owning action is cancelled', async () => {
        const { url } = await endpoint();
        const client = await ComputerCdp.connect(url);
        const abort = new AbortController();
        const request = client.request('Page.navigate', { url: 'https://example.com' }, abort.signal);
        abort.abort();
        await expect(request).rejects.toThrow('cancelled');
        client.close();
    });
});
