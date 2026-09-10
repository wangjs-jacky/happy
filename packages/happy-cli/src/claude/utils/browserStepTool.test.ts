import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createBrowserStepReporter, registerBrowserStepTool } from './startHappyServer';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const directories: string[] = [];
async function frame(sessionId = 'session-a', runId = 'run-a', taskSpaceId = 42) {
    const dir = await mkdtemp(join(tmpdir(), 'paws-browser-step-'));
    directories.push(dir);
    const path = join(dir, 'screenshot.png');
    const context = { sessionId, runId, skillName: 'ego-browser' as const, taskSpaceId, targetId: 'tab-a', url: 'https://example.test/' };
    await writeFile(path, png, { mode: 0o600 });
    await writeFile(join(dir, 'evidence.json'), JSON.stringify({
        version: 1, ...context, sha256: createHash('sha256').update(png).digest('hex'),
    }), { mode: 0o600 });
    return { path, label: ' Verified ', runId, skillName: context.skillName };
}
function client(sessionId = 'session-a') {
    const uploads: Buffer[] = [];
    const events: unknown[][] = [];
    return {
        sessionId, uploads, events,
        async uploadImageAttachment(path: string) {
            uploads.push(await readFile(path));
            return { ref: sessionId + '/ref-' + uploads.length, name: 'screenshot.png', size: png.length, dims: { width: 1, height: 1 }, motionPhoto: null };
        },
        sendFileEvent: (...args: unknown[]) => { events.push(args); },
    };
}
afterEach(async () => {
    await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('session-bound browser evidence reporter', () => {
    it('rejects shared Ego screenshots and arbitrary renamed images', async () => {
        const c = client();
        const report = createBrowserStepReporter(c);
        for (const path of ['/tmp/ego-browser-shot-86506-1.png', '/tmp/copied-image.png']) {
            expect((await report({ path, label: 'Verified', runId: 'run-a', skillName: 'ego-browser' })).success).toBe(false);
        }
        expect(c.uploads).toEqual([]);
    });

    it('routes interleaved sessions only to their own client and rejects cross-session evidence', async () => {
        const a = client(), b = client('session-b');
        const reportA = createBrowserStepReporter(a), reportB = createBrowserStepReporter(b);
        const frameA = await frame(), frameB = await frame('session-b', 'run-b', 43);
        expect((await reportA(frameB)).error).toMatch(/another session/);
        expect((await reportB(frameA)).error).toMatch(/another session/);
        expect(a.events).toEqual([]); expect(b.events).toEqual([]);
        const results = await Promise.all([reportB(frameB), reportA(frameA)]);
        expect(results.every(r => r.success)).toBe(true);
        expect(a.uploads).toEqual([png]); expect(b.uploads).toEqual([png]);
        expect(a.events[0][4]).toEqual({ source: 'browser_step', browserStep: { label: 'Verified', runId: 'run-a', skillName: 'ego-browser' } });
        expect(b.events[0][4]).toEqual({ source: 'browser_step', browserStep: { label: 'Verified', runId: 'run-b', skillName: 'ego-browser' } });
    });

    it('keeps one run across commands but rejects another task space or duplicate frame', async () => {
        const c = client(); const report = createBrowserStepReporter(c);
        const first = await frame();
        expect((await report(first)).success).toBe(true);
        expect((await report(await frame())).success).toBe(true);
        expect((await report(first)).error).toMatch(/already reported/);
        expect((await report(await frame('session-a', 'run-a', 43))).error).toMatch(/another Ego task space/);
        expect(c.uploads).toHaveLength(2);
    });

    it('rejects swapped run IDs, changed pixels and missing receipts before upload', async () => {
        const c = client(); const report = createBrowserStepReporter(c);
        const f = await frame();
        expect((await report({ ...f, runId: 'run-other' })).error).toMatch(/another session, run or skill/);
        await writeFile(f.path, Buffer.from('changed'));
        expect((await report(f)).error).toMatch(/changed/);
        const g = await frame();
        await rm(join(g.path, '..', 'evidence.json'));
        expect((await report(g)).success).toBe(false);
        expect(c.uploads).toEqual([]);
    });

    it('deduplicates concurrent reports and permits retry after upload failure', async () => {
        const c = client(); const upload = c.uploadImageAttachment;
        let fail = true;
        c.uploadImageAttachment = async path => { if (fail) throw new Error('upload unavailable'); return upload(path); };
        const report = createBrowserStepReporter(c); const f = await frame();
        expect((await report(f)).success).toBe(false);
        fail = false;
        const results = await Promise.all([report(f), report(f)]);
        expect(results.filter(r => r.success)).toHaveLength(1);
        expect(c.events).toHaveLength(1);
    });

    it('forwards required task metadata through the MCP tool', async () => {
        let handler: ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
        const server = { registerTool: vi.fn((_name, _config, nextHandler) => { handler = nextHandler; }) } as unknown as McpServer;
        const report = vi.fn(async () => ({ success: true }));
        registerBrowserStepTool(server, report);
        const args = await frame();
        await handler?.(args);
        expect(report).toHaveBeenCalledWith(args);
    });

    it('exposes capture session identity through shared tools for Gemini and ACP too', () => {
        const registerTool = vi.fn();
        registerBrowserStepTool({ registerTool } as unknown as McpServer, async () => ({ success: true }), 'session-acp');
        expect(registerTool.mock.calls[0][1].description).toContain('Current Happy browser capture sessionId: "session-acp"');
    });
});
