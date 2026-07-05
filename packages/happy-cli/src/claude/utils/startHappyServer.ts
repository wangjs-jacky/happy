/**
 * Happy MCP server
 * Provides Happy CLI specific tools including chat session title management
 * and current-session lifecycle actions.
 *
 * Uses stateless StreamableHTTP: each request gets a fresh McpServer + transport.
 * This is required by MCP SDK >=1.27 which rejects reuse of an already-connected transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { fetchFinanceChart } from "@/finance/financeChart";

type HappyMcpHandlers = {
    changeTitle: (title: string) => Promise<{ success: boolean; error?: string }>;
    sendImage: (path: string) => Promise<{ success: boolean; error?: string }>;
    archiveSession: (reason?: string) => Promise<{ success: boolean; error?: string }>;
    financeChart: (input: {
        query: string;
        range?: '5d' | '1mo' | '3mo' | '6mo' | '1y';
        interval?: '1d';
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
};

function createMcpServer(handlers: HappyMcpHandlers): McpServer {
    const mcp = new McpServer({
        name: "Happy MCP",
        version: "1.0.0",
    });

    mcp.registerTool('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: {
            title: z.string().describe('The new title for the chat session'),
        },
    }, async (args) => {
        const response = await handlers.changeTitle(args.title);
        logger.debug('[happyMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Successfully changed chat title to: "${args.title}"`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool('send_image', {
        description: 'Send a local image file into the current chat so the user sees it inline (works on phone and desktop). Use after generating or editing an image. Provide an absolute path to a PNG/JPEG.',
        title: 'Send Image To Chat',
        inputSchema: {
            path: z.string().describe('Absolute path to the local image file (PNG/JPEG)'),
        },
    }, async (args) => {
        const response = await handlers.sendImage(args.path);
        logger.debug('[happyMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Sent image to chat: ${args.path}`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to send image: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool('archive_session', {
        description: 'Archive and stop the current Happy chat session. Only use this when the user explicitly asks to archive, close, or end the current session after finishing the task.',
        title: 'Archive Current Chat Session',
        inputSchema: {
            reason: z.string().optional().describe('Optional short reason for archiving the session'),
        },
    }, async (args) => {
        const response = await handlers.archiveSession(args.reason);

        logger.debug('[happyMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Archived current chat session',
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to archive chat session: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool('finance_chart', {
        description: 'Fetch real market OHLC chart data for a stock, index, ETF, or crypto symbol and return a Happy finance chart block for chat rendering.',
        title: 'Fetch Finance Chart',
        inputSchema: {
            query: z.string().describe('Stock/index query or symbol, such as 上证指数, 000001.SS, AAPL, or 0700.HK'),
            range: z.enum(['5d', '1mo', '3mo', '6mo', '1y']).optional().describe('Chart range. Defaults to 1mo.'),
            interval: z.enum(['1d']).optional().describe('Chart interval. Defaults to 1d.'),
        },
    }, async (args) => {
        const response = await handlers.financeChart({
            query: args.query,
            ...(args.range ? { range: args.range } : {}),
            ...(args.interval ? { interval: args.interval } : {}),
        });
        logger.debug('[happyMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(response.data, null, 2),
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to fetch finance chart: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    return mcp;
}

export async function startHappyServer(
    client: ApiSessionClient,
    options?: {
        archiveSession?: (reason?: string) => Promise<{ success: boolean; error?: string }>;
    },
) {
    logger.debug(`[happyMCP] server:start sessionId=${client.sessionId}`);

    const handlers: HappyMcpHandlers = {
        changeTitle: async (title: string) => {
            logger.debug('[happyMCP] Changing title to:', title);
            try {
                client.sendClaudeSessionMessage({
                    type: 'summary',
                    summary: title,
                    leafUuid: randomUUID()
                });
                return { success: true };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
        sendImage: async (path: string) => {
            logger.debug('[happyMCP] Sending image:', path);
            try {
                const { ref, name, size, dims } = await client.uploadImageAttachment(path);
                client.sendFileEvent(ref, name, size, dims);
                return { success: true };
            } catch (error) {
                return { success: false, error: String(error) };
            }
        },
        archiveSession: async (reason?: string) => {
            logger.debug('[happyMCP] Archiving current session:', reason);
            if (!options?.archiveSession) {
                return { success: false, error: 'Archive handler is not configured' };
            }
            return options.archiveSession(reason);
        },
        financeChart: async (input) => {
            logger.debug('[happyMCP] Fetching finance chart:', input);
            try {
                const data = await fetchFinanceChart(input);
                return { success: true, data };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        },
    };

    const server = createServer(async (req, res) => {
        const mcp = createMcpServer(handlers);
        try {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined
            });
            await mcp.connect(transport);
            await transport.handleRequest(req, res);
            res.on('close', () => {
                transport.close();
                mcp.close();
            });
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
            mcp.close();
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    logger.debug(`[happyMCP] server:ready sessionId=${client.sessionId} url=${baseUrl.toString()}`);

    return {
        url: baseUrl.toString(),
        toolNames: ['change_title', 'send_image', 'archive_session', 'finance_chart'],
        stop: () => {
            logger.debug(`[happyMCP] server:stop sessionId=${client.sessionId}`);
            server.close();
        }
    }
}
