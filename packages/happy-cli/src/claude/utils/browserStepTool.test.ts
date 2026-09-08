import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createBrowserStepReporter, registerBrowserStepTool } from './startHappyServer';

describe('Claude Happy MCP browser-step producer', () => {
    it('rejects shared Ego screenshot paths before they can upload another task\'s pixels', async () => {
        const uploaded: string[] = [];
        const events: unknown[][] = [];
        const report = createBrowserStepReporter({
            async uploadImageAttachment(path: string) {
                uploaded.push(path);
                return { ref: 'wrong-task', name: 'shot.png', size: 1, dims: null, motionPhoto: null };
            },
            sendFileEvent: (...args: unknown[]) => { events.push(args); },
        } as never);

        for (const path of ['/tmp/ego-browser-shot-86506-1.png', '/tmp/ego-browser-shot-23-12.jpeg']) {
            const result = await report({ path, label: 'Verified Paws', runId: 'paws-run', skillName: 'ego-browser' });
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/captureVerifiedBrowserStep/);
        }
        expect(uploaded).toEqual([]);
        expect(events).toEqual([]);
    });

    it('forwards optional stable run metadata from the MCP tool to the reporter', async () => {
        let handler: ((args: Record<string, unknown>) => Promise<unknown>) | undefined;
        const server = {
            registerTool: vi.fn((_name, _config, nextHandler) => { handler = nextHandler; }),
        } as unknown as McpServer;
        const reportBrowserStep = vi.fn(async () => ({ success: true }));
        registerBrowserStepTool(server, reportBrowserStep);

        await handler?.({
            path: '/tmp/step.png',
            label: 'Verified settings',
            runId: 'ego-task-42',
            skillName: 'ego-browser',
        });

        expect(reportBrowserStep).toHaveBeenCalledWith({
            path: '/tmp/step.png',
            label: 'Verified settings',
            runId: 'ego-task-42',
            skillName: 'ego-browser',
        });
    });

    it('emits the same task run ID on every frame and preserves label-only legacy events', async () => {
        const sendFileEvent = vi.fn();
        const client = {
            uploadImageAttachment: vi.fn()
                .mockResolvedValueOnce({ ref: 'r1', name: 'one.png', size: 1, dims: { width: 1, height: 1 } })
                .mockResolvedValueOnce({ ref: 'r2', name: 'two.png', size: 2, dims: { width: 2, height: 2 } })
                .mockResolvedValueOnce({ ref: 'r3', name: 'legacy.png', size: 3, dims: null }),
            sendFileEvent,
        };
        const report = createBrowserStepReporter(client as never);

        await report({ path: '/tmp/one.png', label: ' One ', runId: 'ego-task-42', skillName: 'ego-ops' });
        await report({ path: '/tmp/two.png', label: ' Two ', runId: 'ego-task-42', skillName: 'ego-ops' });
        await report({ path: '/tmp/legacy.png', label: ' Legacy ' });

        expect(sendFileEvent.mock.calls.map((call) => call[4]?.browserStep)).toEqual([
            { label: 'One', runId: 'ego-task-42', skillName: 'ego-ops' },
            { label: 'Two', runId: 'ego-task-42', skillName: 'ego-ops' },
            { label: 'Legacy' },
        ]);
    });
});
