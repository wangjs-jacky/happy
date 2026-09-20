import axios from 'axios';
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
    try {
        const response = await axios.post(endpoint, {
            client_id: 'app_EMoamEEZ73f0CkXaXp7hrann', grant_type: 'refresh_token', refresh_token: auth.tokens.refresh_token,
        }, { timeout: 15_000, maxRedirects: 0, maxContentLength: 70 * 1024, maxBodyLength: 70 * 1024,
            headers: { 'Content-Type': 'application/json' }, validateStatus: () => true });
        if (response.status !== 200) throw new CodexOAuthRefreshError(response.status === 400 || response.status === 401);
        const value = z.object({ access_token: z.string().min(1).max(24000),
            refresh_token: z.string().min(1).max(24000).optional(), id_token: z.string().min(1).max(24000).optional() }).parse(response.data);
        const claims = JSON.parse(Buffer.from(value.access_token.split('.')[1], 'base64url').toString());
        if (claims['https://api.openai.com/auth']?.chatgpt_account_id !== auth.tokens.account_id) throw new CodexOAuthRefreshError(false);
        return codexAuthSchema.parse({ ...auth, last_refresh: new Date().toISOString(), tokens: {
            ...auth.tokens, ...value,
        } });
    } catch (error) {
        throw error instanceof CodexOAuthRefreshError ? error : new CodexOAuthRefreshError(false);
    }
}

export function codexAccessNeedsRefresh(auth: CodexAuth): boolean {
    try {
        const claims = JSON.parse(Buffer.from(auth.tokens.access_token.split('.')[1], 'base64url').toString());
        if (typeof claims.exp === 'number') return claims.exp * 1000 <= Date.now() + 60_000;
    } catch { /* Native older auth files can lack JWT expiry; use their refresh age. */ }
    return !auth.last_refresh || Date.now() - Date.parse(auth.last_refresh) >= 7 * 86400_000;
}
