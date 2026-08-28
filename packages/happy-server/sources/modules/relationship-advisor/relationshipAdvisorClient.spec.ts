import { describe, expect, it, vi } from 'vitest';

import * as relationshipAdvisorClient from '@/modules/relationship-advisor/relationshipAdvisorClient';

const { streamRelationshipAdvisor } = relationshipAdvisorClient;

function streamResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    }), { status: 200 });
}

describe('streamRelationshipAdvisor', () => {
    it('sends multimodal OpenAI-compatible input and yields fragmented SSE deltas', async () => {
        const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => streamResponse([
            'data: {"choices":[{"delta":{"content":"先看"}}]}\n',
            '\ndata: {"choices":[{"delta":{"content":"事实"}}]}\n\n',
            'data: [DONE]\n\n',
        ]));
        const validateBaseUrl = vi.fn(async (value: string) => value);

        const deltas: string[] = [];
        for await (const delta of streamRelationshipAdvisor({
            messages: [
                { role: 'assistant', text: '把截图发来吧。' },
                { role: 'user', text: '右侧蓝色气泡是我。' },
            ],
            imageUrls: ['https://oss.test/advisor/image.jpg?signature=short-lived'],
        }, {
            apiKey: 'server-only-key',
            baseUrl: 'https://model.test/v1',
            model: 'fast-vision-model',
            fetchImpl: fetchImpl as typeof fetch,
            validateBaseUrl,
        })) {
            deltas.push(delta.text);
        }

        expect(deltas).toEqual(['先看', '事实']);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(validateBaseUrl).toHaveBeenCalledWith('https://model.test/v1');
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://model.test/v1/chat/completions');
        expect(init?.headers).toEqual(expect.objectContaining({
            Authorization: 'Bearer server-only-key',
        }));
        expect(init?.redirect).toBe('error');
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual(expect.objectContaining({
            model: 'fast-vision-model',
            stream: true,
        }));
        expect(body.messages[0].role).toBe('system');
        expect(body.messages.at(-1)).toEqual({
            role: 'user',
            content: [
                { type: 'text', text: '右侧蓝色气泡是我。' },
                { type: 'image_url', image_url: { url: 'https://oss.test/advisor/image.jpg?signature=short-lived' } },
            ],
        });
    });

    it('does not send the API key when provider URL validation fails', async () => {
        const fetchImpl = vi.fn();

        const consume = async () => {
            for await (const _delta of streamRelationshipAdvisor({
                messages: [{ role: 'user', text: 'hello' }],
                imageUrls: [],
            }, {
                apiKey: 'must-not-leak',
                baseUrl: 'https://internal.example/v1',
                model: 'private-model',
                fetchImpl: fetchImpl as typeof fetch,
                validateBaseUrl: vi.fn(async () => { throw new Error('unsafe'); }),
            })) {
                // No deltas are expected.
            }
        };

        await expect(consume()).rejects.toThrow('unsafe');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});

describe('testRelationshipAdvisorConnection', () => {
    it('checks the configured chat endpoint with a one-token non-streaming request', async () => {
        const testConnection = (relationshipAdvisorClient as typeof relationshipAdvisorClient & {
            testRelationshipAdvisorConnection?: (
                configuration: { apiKey: string; baseUrl: string; model: string },
                options: { fetchImpl: typeof fetch; validateBaseUrl: (value: string) => Promise<string> },
            ) => Promise<{ success: boolean; latencyMs?: number }>;
        }).testRelationshipAdvisorConnection;
        expect(testConnection).toBeTypeOf('function');
        if (!testConnection) return;

        const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({
            choices: [{ message: { content: 'OK' } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        await expect(testConnection({
            apiKey: 'server-only-key',
            baseUrl: 'https://model.test/v1',
            model: 'fast-model',
        }, {
            fetchImpl: fetchImpl as typeof fetch,
            validateBaseUrl: vi.fn(async (value: string) => value),
        })).resolves.toMatchObject({ success: true });

        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://model.test/v1/chat/completions');
        expect(init?.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer server-only-key' }));
        expect(JSON.parse(String(init?.body))).toEqual({
            model: 'fast-model',
            messages: [{ role: 'user', content: 'Reply with OK.' }],
            stream: false,
            max_tokens: 1,
            temperature: 0,
        });
    });

    it.each([
        [401, 'authentication_failed'],
        [404, 'model_not_found'],
        [429, 'rate_limited'],
        [500, 'provider_error'],
    ])('maps provider HTTP %s to %s', async (status, code) => {
        const testConnection = (relationshipAdvisorClient as typeof relationshipAdvisorClient & {
            testRelationshipAdvisorConnection?: (
                configuration: { apiKey: string; baseUrl: string; model: string },
                options: { fetchImpl: typeof fetch; validateBaseUrl: (value: string) => Promise<string> },
            ) => Promise<{ success: boolean; code?: string }>;
        }).testRelationshipAdvisorConnection;
        expect(testConnection).toBeTypeOf('function');
        if (!testConnection) return;

        await expect(testConnection({
            apiKey: 'server-only-key',
            baseUrl: 'https://model.test/v1',
            model: 'fast-model',
        }, {
            fetchImpl: vi.fn(async () => new Response('', { status })) as typeof fetch,
            validateBaseUrl: vi.fn(async (value: string) => value),
        })).resolves.toEqual({ success: false, code });
    });

    it('rejects an HTTP 200 response that is not a chat completion', async () => {
        const testConnection = (relationshipAdvisorClient as typeof relationshipAdvisorClient & {
            testRelationshipAdvisorConnection?: (
                configuration: { apiKey: string; baseUrl: string; model: string },
                options: { fetchImpl: typeof fetch; validateBaseUrl: (value: string) => Promise<string> },
            ) => Promise<{ success: boolean; code?: string }>;
        }).testRelationshipAdvisorConnection;
        expect(testConnection).toBeTypeOf('function');
        if (!testConnection) return;

        await expect(testConnection({
            apiKey: 'server-only-key',
            baseUrl: 'https://model.test/v1',
            model: 'fast-model',
        }, {
            fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: 'proxy fallback' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })) as typeof fetch,
            validateBaseUrl: vi.fn(async (value: string) => value),
        })).resolves.toEqual({ success: false, code: 'provider_error' });
    });

    it('distinguishes a timeout from an unreachable provider', async () => {
        const testConnection = (relationshipAdvisorClient as typeof relationshipAdvisorClient & {
            testRelationshipAdvisorConnection?: (
                configuration: { apiKey: string; baseUrl: string; model: string },
                options: {
                    fetchImpl: typeof fetch;
                    timeoutMs: number;
                    validateBaseUrl: (value: string) => Promise<string>;
                },
            ) => Promise<{ success: boolean; code?: string }>;
        }).testRelationshipAdvisorConnection;
        expect(testConnection).toBeTypeOf('function');
        if (!testConnection) return;

        const abortingFetch = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
                const error = new Error('Aborted');
                error.name = 'AbortError';
                reject(error);
            });
        })) as typeof fetch;
        const options = {
            fetchImpl: abortingFetch,
            timeoutMs: 1,
            validateBaseUrl: vi.fn(async (value: string) => value),
        };
        const configuration = {
            apiKey: 'server-only-key',
            baseUrl: 'https://model.test/v1',
            model: 'fast-model',
        };

        await expect(testConnection(configuration, options)).resolves.toEqual({
            success: false,
            code: 'timed_out',
        });
        await expect(testConnection(configuration, {
            ...options,
            fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed'); }) as typeof fetch,
        })).resolves.toEqual({ success: false, code: 'provider_unreachable' });
    });
});
