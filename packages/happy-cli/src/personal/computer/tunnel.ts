import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';

/** Host-loopback transport into one verified container, with no Docker network
 * publication. The untrusted job network cannot reach this CDP endpoint. */
export async function computerTunnel(container: string): Promise<{ port: number; close: () => Promise<void> }> {
    if (!/^paws-pc-[a-f0-9]{16}$/.test(container)) throw new Error('Invalid computer container identity');
    const sockets = new Set<Socket>();
    const server = createServer(socket => {
        sockets.add(socket);
        const child = spawn('docker', ['exec', '-i', container, 'socat', '-', 'TCP:127.0.0.1:9222'], { stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdin.on('error', () => socket.destroy());
        child.stdout.on('error', () => socket.destroy());
        child.stderr.resume();
        socket.pipe(child.stdin); child.stdout.pipe(socket);
        child.once('error', () => socket.destroy());
        child.once('close', () => socket.destroy());
        socket.once('close', () => { sockets.delete(socket); child.stdin.destroy(); child.kill('SIGKILL'); });
        socket.once('error', () => { child.stdin.destroy(); child.kill('SIGKILL'); });
    });
    server.maxConnections = 8;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Computer tunnel did not bind loopback');
    return { port: address.port, close: async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
    } };
}
