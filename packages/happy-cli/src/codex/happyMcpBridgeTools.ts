/**
 * Happy MCP bridge tools.
 *
 * Registers first-party Happy MCP tools on the stdio bridge and forwards
 * invocations to the per-session HTTP MCP server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const HAPPY_MCP_BRIDGE_TOOL_NAMES = ['change_title', 'send_image'] as const;

type HappyMcpBridgeToolName = typeof HAPPY_MCP_BRIDGE_TOOL_NAMES[number];

async function forwardHappyToolCall(
  name: HappyMcpBridgeToolName,
  args: Record<string, unknown>,
  ensureHttpClient: () => Promise<Client>,
  failurePrefix: string
): Promise<CallToolResult> {
  try {
    const client = await ensureHttpClient();
    return await client.callTool({ name, arguments: args }) as CallToolResult;
  } catch (error) {
    return {
      content: [
        { type: 'text', text: `${failurePrefix}: ${error instanceof Error ? error.message : String(error)}` },
      ],
      isError: true,
    };
  }
}

export function registerHappyBridgeTools(
  server: McpServer,
  ensureHttpClient: () => Promise<Client>
): void {
  server.registerTool(
    'change_title',
    {
      description: 'Change the title of the current chat session',
      title: 'Change Chat Title',
      inputSchema: {
        title: z.string().describe('The new title for the chat session'),
      },
    },
    async (args) => forwardHappyToolCall(
      'change_title',
      { title: args.title },
      ensureHttpClient,
      'Failed to change chat title'
    )
  );

  server.registerTool(
    'send_image',
    {
      description: 'Send a local image file into the current chat so the user sees it inline (works on phone and desktop). Use after generating or editing an image. Provide an absolute path to a PNG/JPEG.',
      title: 'Send Image To Chat',
      inputSchema: {
        path: z.string().describe('Absolute path to the local image file (PNG/JPEG)'),
      },
    },
    async (args) => forwardHappyToolCall(
      'send_image',
      { path: args.path },
      ensureHttpClient,
      'Failed to send image'
    )
  );
}
