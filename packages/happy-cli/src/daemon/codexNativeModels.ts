/** Read the machine's native Codex/Magpie directory without creating an inference thread. */
import { z } from 'zod';
import { CodexAppServerClient } from '@/codex/codexAppServerClient';

export type CodexNativeModelsResult =
    | { type: 'success'; models: Array<{ code: string; value: string; description?: string | null }> }
    | { type: 'error'; errorMessage: string };

const modelPageSchema = z.object({
    data: z.array(z.object({
        model: z.string().min(1),
        displayName: z.string().nullish(),
        description: z.string().nullish(),
        hidden: z.boolean().optional(),
    })),
    nextCursor: z.string().nullable().optional(),
});
const NATIVE_MODELS_ERROR = 'Unable to read native Codex models. Check the machine’s native Codex connection and try again.';

/** Managed homes contain a different provider. Never reuse one for native discovery. */
export function nativeCodexModelEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...base, HAPPY_CODEX_APP_SERVER_MODE: 'spawn' };
    if (base.HAPPY_CODEX_ACCOUNT_PROFILE_ID || base.HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION) delete env.CODEX_HOME;
    for (const key of Object.keys(env)) {
        if (key.startsWith('HAPPY_CODEX_ACCOUNT_')) delete env[key];
    }
    delete env.HAPPY_CODEX_APP_SERVER_SOCKET;
    return env;
}

/** One explicit refresh uses its own short-lived process, even when a shared worker is configured. */
export async function listCodexNativeModels(base: NodeJS.ProcessEnv = process.env): Promise<CodexNativeModelsResult> {
    const client = new CodexAppServerClient(undefined, { type: 'spawn' }, nativeCodexModelEnvironment(base));
    let result: CodexNativeModelsResult;
    try {
        await client.connect();
        const models: Extract<CodexNativeModelsResult, { type: 'success' }>['models'] = [];
        const cursors = new Set<string>();
        let cursor: string | null = null;
        let count = 0;
        do {
            const page = modelPageSchema.parse(await client.listModels({ cursor, includeHidden: false, limit: 100 }));
            count += page.data.length;
            if (count > 1024 || cursors.size >= 32) throw new Error('Invalid native model directory');
            for (const model of page.data) {
                if (model.hidden) continue;
                models.push({ code: model.model, value: model.displayName || model.model,
                    ...(model.description !== undefined ? { description: model.description } : {}) });
            }
            cursor = page.nextCursor ?? null;
            if (cursor && cursors.has(cursor)) throw new Error('Invalid native model directory');
            if (cursor) cursors.add(cursor);
        } while (cursor);
        if (!models.length) throw new Error('Empty native model directory');
        result = { type: 'success', models };
    } catch {
        // Provider errors can contain credential material or local configuration. Return no raw errors.
        result = { type: 'error', errorMessage: NATIVE_MODELS_ERROR };
    } finally {
        try { await client.disconnect({ waitForExit: true }); }
        catch { result = { type: 'error', errorMessage: NATIVE_MODELS_ERROR }; }
    }
    return result;
}
