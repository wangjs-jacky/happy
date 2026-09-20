import { EnvHttpProxyAgent, request } from 'undici';
import { z } from 'zod';
import { codexAuthSchema, type CodexAuth } from './codexAccountTypes';

export class CodexOAuthRefreshError extends Error {
    constructor(readonly definitive: boolean) { super('Codex credential refresh failed'); }
}

/** Keep provider bodies and request credentials out of error/log paths. */
export async function refreshCodexOAuth(auth: CodexAuth): Promise<CodexAuth> {
    // A loopback-only override supports real native-client E2E without production OAuth.
    const override = process.env.PAWS_CODEX_OAUTH_TEST_URL;
    let endpoint = 'https://auth.openai.com/oauth/token';
    if (override) {
        const url = new URL(override);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new CodexOAuthRefreshError(false);
        endpoint = url.href;
    }
    // HTTPS must use CONNECT through an HTTP proxy. Axios's forward-proxy
    // rewriting can send plaintext HTTP to the provider's HTTPS port.
    const dispatcher = new EnvHttpProxyAgent();
    try {
        const response = await request(endpoint, {
            dispatcher, method: 'POST', body: JSON.stringify({
            client_id: 'app_EMoamEEZ73f0CkXaXp7hrann', grant_type: 'refresh_token', refresh_token: auth.tokens.refresh_token,
            }), signal: AbortSignal.timeout(15_000), headersTimeout: 15_000, bodyTimeout: 15_000, maxRedirections: 0,
            headers: { 'Content-Type': 'application/json' },
        });
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of response.body) {
            const bytes = Buffer.from(chunk); size += bytes.length;
            if (size > 70 * 1024) { response.body.destroy(); throw new CodexOAuthRefreshError(false); }
            chunks.push(bytes);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        // HTML proxy errors are not authoritative provider token rejection.
        if (response.statusCode !== 200) throw new CodexOAuthRefreshError(
            (response.statusCode === 400 || response.statusCode === 401)
                && (typeof data?.error === 'string' || typeof data?.error?.code === 'string'),
        );
        const value = z.object({ access_token: z.string().min(1).max(24000),
            refresh_token: z.string().min(1).max(24000).optional(), id_token: z.string().min(1).max(24000).optional() }).parse(data);
        const claims = JSON.parse(Buffer.from(value.access_token.split('.')[1], 'base64url').toString());
        if (claims['https://api.openai.com/auth']?.chatgpt_account_id !== auth.tokens.account_id) throw new CodexOAuthRefreshError(false);
        return codexAuthSchema.parse({ ...auth, last_refresh: new Date().toISOString(), tokens: {
            ...auth.tokens, ...value,
        } });
    } catch (error) {
        throw error instanceof CodexOAuthRefreshError ? error : new CodexOAuthRefreshError(false);
    } finally {
        await dispatcher.close().catch(() => undefined);
    }
}

export function codexAccessNeedsRefresh(auth: CodexAuth): boolean {
    try {
        const claims = JSON.parse(Buffer.from(auth.tokens.access_token.split('.')[1], 'base64url').toString());
        if (typeof claims.exp === 'number') return claims.exp * 1000 <= Date.now() + 60_000;
    } catch { /* Native older auth files can lack JWT expiry; use their refresh age. */ }
    return !auth.last_refresh || Date.now() - Date.parse(auth.last_refresh) >= 7 * 86400_000;
}

/** Continuing after refresh uncertainty requires an explicit finite JWT expiry. */
export function codexAccessIsUnexpired(auth: CodexAuth): boolean {
    try {
        const claims = JSON.parse(Buffer.from(auth.tokens.access_token.split('.')[1], 'base64url').toString());
        return typeof claims.exp === 'number' && Number.isFinite(claims.exp)
            && claims.exp * 1000 > Date.now() + 60_000;
    } catch { return false; }
}
