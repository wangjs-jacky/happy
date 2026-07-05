import { describe, expect, it, vi } from 'vitest';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import {
    HAPPY_MCP_BRIDGE_TOOL_NAMES,
    registerHappyBridgeTools,
} from './happyMcpBridgeTools';

type ToolRegistration = {
    name: string;
    config: {
        description?: string;
        title?: string;
        inputSchema?: Record<string, unknown>;
    };
    handler: (args: Record<string, unknown>) => Promise<unknown>;
};

function createServerMock(): { server: McpServer; registrations: ToolRegistration[] } {
    const registrations: ToolRegistration[] = [];
    const server = {
        registerTool: vi.fn((
            name: string,
            config: ToolRegistration['config'],
            handler: ToolRegistration['handler']
        ) => {
            registrations.push({ name, config, handler });
        }),
    };

    return { server: server as unknown as McpServer, registrations };
}

describe('registerHappyBridgeTools', () => {
    it('registers every first-party Happy bridge tool, including send_image', () => {
        const { server, registrations } = createServerMock();

        registerHappyBridgeTools(server, async () => ({}) as Client);

        expect(registrations.map((registration) => registration.name)).toEqual([...HAPPY_MCP_BRIDGE_TOOL_NAMES]);
        expect(registrations.find((registration) => registration.name === 'send_image')?.config).toMatchObject({
            title: 'Send Image To Chat',
        });
        expect(registrations.find((registration) => registration.name === 'send_image')?.config.description)
            .toContain('current chat');
        expect(registrations.find((registration) => registration.name === 'send_image')?.config.inputSchema)
            .toHaveProperty('path');
    });

    it('forwards send_image calls to the HTTP MCP client', async () => {
        const { server, registrations } = createServerMock();
        const callTool = vi.fn(async (params: { name: string; arguments?: Record<string, unknown> }) => ({
            content: [{ type: 'text' as const, text: `ok ${params.name}` }],
            isError: false,
        }));

        registerHappyBridgeTools(server, async () => ({ callTool }) as unknown as Client);

        const sendImage = registrations.find((registration) => registration.name === 'send_image');
        expect(sendImage).toBeDefined();

        const result = await sendImage?.handler({ path: '/tmp/render.png' });

        expect(callTool).toHaveBeenCalledWith({
            name: 'send_image',
            arguments: { path: '/tmp/render.png' },
        });
        expect(result).toMatchObject({
            content: [{ type: 'text', text: 'ok send_image' }],
            isError: false,
        });
    });

    it('returns an MCP error result when forwarding fails', async () => {
        const { server, registrations } = createServerMock();

        registerHappyBridgeTools(server, async () => {
            throw new Error('HTTP MCP unavailable');
        });

        const sendImage = registrations.find((registration) => registration.name === 'send_image');
        expect(sendImage).toBeDefined();

        const result = await sendImage?.handler({ path: '/tmp/render.png' });

        expect(result).toMatchObject({
            content: [{ type: 'text', text: 'Failed to send image: HTTP MCP unavailable' }],
            isError: true,
        });
    });
});
