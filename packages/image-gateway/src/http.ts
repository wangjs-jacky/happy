import type { IncomingMessage, ServerResponse } from 'node:http';

export async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

export async function readInput(request: IncomingMessage): Promise<Record<string, string>> {
    const body = await readBody(request);
    const contentType = request.headers['content-type'] ?? '';
    if (contentType.includes('application/json')) {
        return JSON.parse(body || '{}') as Record<string, string>;
    }
    return Object.fromEntries(new URLSearchParams(body).entries());
}

export function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    response.end(JSON.stringify(payload, null, 2));
}

export function sendHtml(response: ServerResponse, statusCode: number, html: string) {
    response.writeHead(statusCode, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
    });
    response.end(html);
}

export function redirect(response: ServerResponse, location: string) {
    response.writeHead(303, { location });
    response.end();
}

export function requireToken(request: IncomingMessage, expected: string | undefined, queryToken?: string | null): boolean {
    if (!expected) return false;
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    return bearer === expected || queryToken === expected;
}
