import { isIP } from 'node:net';
import { posix } from 'node:path';

export function workspacePath(input: string): string {
    if (!input || input.includes('\0') || input.includes('\\')) throw new Error('Invalid workspace path');
    const path = posix.resolve('/workspace', input);
    if (path !== '/workspace' && !path.startsWith('/workspace/')) throw new Error('Path leaves the computer workspace');
    return path;
}

export function browserUrl(input: string): string {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) pages can be opened');
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIP(host) && !publicAddress(host)) throw new Error('Private network destinations are unavailable');
    return url.href;
}

/** Mirrors the trusted egress proxy's public-unicast checks. */
export function publicAddress(value: string): boolean {
    const address = value.toLowerCase();
    if (isIP(address) === 4) {
        const p = address.split('.').map(Number);
        return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224
            || p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31
            || p[0] === 192 && (p[1] === 168 || p[1] === 0)
            || p[0] === 100 && p[1] >= 64 && p[1] <= 127 || p[0] === 198 && (p[1] === 18 || p[1] === 19));
    }
    return isIP(address) === 6 && /^[23][0-9a-f]{3}:/.test(address)
        && !address.startsWith('2001:db8:') && !address.startsWith('2001:0:') && !address.startsWith('2002:');
}

export class ComputerControl {
    epoch = 0;
    viewer: string | null = null;
    takeover(viewer: string): void {
        // This is an explicit, authenticated owner action. Reclaiming from a
        // closed/refreshed client invalidates that client's old lease.
        this.epoch++; this.viewer = viewer;
    }
    release(viewer: string, epoch: number): void {
        this.assertHuman(viewer, epoch); this.epoch++; this.viewer = null;
    }
    assertHuman(viewer: string, epoch: number): void {
        if (viewer !== this.viewer || epoch !== this.epoch) throw new Error('Computer control changed; refresh before acting');
    }
    assertAgent(epoch: number): void {
        if (this.viewer || epoch !== this.epoch) throw new Error('Computer is under human control or the action is stale');
    }
    stop(epoch: number): void {
        if (epoch !== this.epoch) throw new Error('Computer control changed; refresh before stopping');
        this.epoch++;
        // A stop/disconnect never implicitly hands control back to the agent.
    }
}
