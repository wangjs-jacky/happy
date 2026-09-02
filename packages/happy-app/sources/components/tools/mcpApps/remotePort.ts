import { decodeBase64 } from '@/encryption/base64';
import {
    mcpAppResourceRpcClient,
    type McpAppResourceOpenResponse,
    type McpAppResourceRpcClient,
} from '@/sync/ops.mcpApps';
import {
    McpAppHostError,
    type CallMcpAppToolInput,
    type McpAppRemotePort,
    type McpAppResource,
    type ReadMcpAppResourceInput,
} from './types';

const MCP_APP_MAX_HTML_BYTES = 5 * 1024 * 1024;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function invalidResource(): McpAppHostError {
    return new McpAppHostError(
        'MCP_APP_INVALID_RESOURCE',
        false,
        'The App resource is invalid.',
    );
}

function resourceTooLarge(): McpAppHostError {
    return new McpAppHostError(
        'MCP_APP_RESOURCE_TOO_LARGE',
        false,
        'The App resource is too large.',
    );
}

function verificationUnavailable(): McpAppHostError {
    return new McpAppHostError(
        'MCP_APP_INTERNAL',
        true,
        'The App resource could not be verified.',
    );
}

function validOpenResponse(
    response: McpAppResourceOpenResponse,
    expectedResourceUri?: string,
): boolean {
    return typeof response.resourceId === 'string' && response.resourceId.length > 0
        && typeof response.uri === 'string' && response.uri.startsWith('ui://')
        && (!expectedResourceUri || response.uri === expectedResourceUri)
        && response.mimeType === 'text/html;profile=mcp-app'
        && Number.isInteger(response.byteLength) && response.byteLength > 0
        && SHA256_HEX.test(response.sha256)
        && response.encoding === 'utf8';
}

function decodeChunk(dataBase64: unknown): Uint8Array {
    if (typeof dataBase64 !== 'string' || !BASE64.test(dataBase64)) {
        throw invalidResource();
    }
    try {
        return decodeBase64(dataBase64);
    } catch {
        throw invalidResource();
    }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const Crypto = await import('expo-crypto');
    const digestInput = new Uint8Array(bytes.byteLength);
    digestInput.set(bytes);
    const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, digestInput));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createMcpAppRemotePort(options: {
    sessionId: string;
    rpc?: McpAppResourceRpcClient;
    hashBytes?: (bytes: Uint8Array) => Promise<string>;
}): McpAppRemotePort {
    const rpc = options.rpc ?? mcpAppResourceRpcClient;
    const hashBytes = options.hashBytes ?? sha256Hex;

    return {
        async readResource(input: ReadMcpAppResourceInput): Promise<McpAppResource> {
            const open = await rpc.openResource(options.sessionId, { callId: input.callId }, input.signal);
            if (!validOpenResponse(open, input.expectedResourceUri)) throw invalidResource();
            if (open.byteLength > MCP_APP_MAX_HTML_BYTES) throw resourceTooLarge();

            const bytes = new Uint8Array(open.byteLength);
            let requestedOffset = 0;
            while (requestedOffset < open.byteLength) {
                const chunk = await rpc.readResourceChunk(options.sessionId, {
                    resourceId: open.resourceId,
                    offset: requestedOffset,
                }, input.signal);
                if (!chunk || chunk.offset !== requestedOffset) throw invalidResource();
                const decoded = decodeChunk(chunk.dataBase64);
                if (decoded.byteLength === 0 || requestedOffset + decoded.byteLength > bytes.byteLength) {
                    throw invalidResource();
                }
                bytes.set(decoded, requestedOffset);
                const decodedEnd = requestedOffset + decoded.byteLength;
                if (chunk.nextOffset !== undefined) {
                    if (!Number.isInteger(chunk.nextOffset) || chunk.nextOffset !== decodedEnd
                        || chunk.nextOffset >= open.byteLength) {
                        throw invalidResource();
                    }
                    requestedOffset = chunk.nextOffset;
                } else {
                    if (decodedEnd !== open.byteLength) throw invalidResource();
                    requestedOffset = decodedEnd;
                }
            }

            let digest: string;
            try {
                digest = await hashBytes(bytes);
            } catch {
                throw verificationUnavailable();
            }
            if (requestedOffset !== open.byteLength || digest !== open.sha256) {
                throw invalidResource();
            }

            let html: string;
            try {
                html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            } catch {
                throw invalidResource();
            }
            return { ...open, html };
        },

        async callTool(_input: CallMcpAppToolInput): Promise<never> {
            throw new McpAppHostError(
                'MCP_APP_UNSUPPORTED',
                false,
                'This App action is not supported.',
            );
        },
    };
}
