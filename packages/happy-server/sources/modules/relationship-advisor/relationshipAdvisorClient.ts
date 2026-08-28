import type { PluginConnectionTestResult } from '@slopus/happy-wire';
import {
    streamRelationshipAdvisor,
    validateRelationshipAdvisorProviderUrl,
} from '@paws/plugins/relationship-advisor/server';

export {
    streamRelationshipAdvisor,
    type RelationshipAdvisorMessage,
    type StreamRelationshipAdvisorInput,
    type StreamRelationshipAdvisorOptions,
} from '@paws/plugins/relationship-advisor/server';

interface RelationshipAdvisorConnectionConfiguration {
    apiKey: string;
    baseUrl: string;
    model: string;
}

interface RelationshipAdvisorConnectionTestOptions {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    validateBaseUrl?: (baseUrl: string) => Promise<string>;
}

function chatCompletionsUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function failureCodeForStatus(status: number): Extract<PluginConnectionTestResult, { success: false }>['code'] {
    if (status === 401 || status === 403) return 'authentication_failed';
    if (status === 404) return 'model_not_found';
    if (status === 429) return 'rate_limited';
    return 'provider_error';
}

/** Sends a minimal provider request so configuration can be checked without storing it. */
export async function testRelationshipAdvisorConnection(
    configuration: RelationshipAdvisorConnectionConfiguration,
    options: RelationshipAdvisorConnectionTestOptions = {},
): Promise<PluginConnectionTestResult> {
    let safeBaseUrl: string;
    try {
        safeBaseUrl = await (options.validateBaseUrl ?? validateRelationshipAdvisorProviderUrl)(configuration.baseUrl);
    } catch {
        return { success: false, code: 'invalid_configuration' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    const startedAt = Date.now();
    try {
        const response = await (options.fetchImpl ?? fetch)(chatCompletionsUrl(safeBaseUrl), {
            method: 'POST',
            redirect: 'error',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${configuration.apiKey}`,
            },
            body: JSON.stringify({
                model: configuration.model,
                messages: [{ role: 'user', content: 'Reply with OK.' }],
                stream: false,
                max_tokens: 1,
                temperature: 0,
            }),
            // Node's fetch and the transitive DOM types expose structurally different
            // AbortSignal declarations, though they share the same runtime object.
            signal: controller.signal as never,
        });
        if (!response.ok) return { success: false, code: failureCodeForStatus(response.status) };
        const body = await response.json().catch(() => null) as { choices?: unknown } | null;
        if (!body || !Array.isArray(body.choices) || body.choices.length === 0) {
            return { success: false, code: 'provider_error' };
        }
        return { success: true, latencyMs: Math.max(0, Date.now() - startedAt) };
    } catch (error) {
        if (controller.signal.aborted || (error as { name?: unknown })?.name === 'AbortError') {
            return { success: false, code: 'timed_out' };
        }
        return { success: false, code: 'provider_unreachable' };
    } finally {
        clearTimeout(timeout);
    }
}
