import { MyAgentProfileSchema, type MyAgentProfile } from '@slopus/happy-wire';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { accountRuntimeCurrent } from '@/auth/accountRuntime';
import { getPartyUrl } from '@/components/agentParty/api';

export function createMyAgentsApi(credentials: AuthCredentials, signal?: AbortSignal) {
    const base = getPartyUrl();
    const assertCurrent = () => {
        if (!accountRuntimeCurrent() || signal?.aborted) throw new Error('账号连接已取消，请重新打开我的 Agent。');
    };
    const request = async (path = '', init: RequestInit = {}): Promise<unknown> => {
        assertCurrent();
        if (!/^(?:\/[a-zA-Z0-9_-]+(?:\/(?:sessions|archive))?)?$/.test(path)) throw new Error('Invalid Agent path');
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(abort, 15000);
        let response: Response;
        let result: unknown;
        try {
            response = await fetch(`${base}api/my-agents${path}`, { ...init, redirect: 'error', signal: controller.signal, headers: { authorization: `Bearer ${credentials.token}`, 'content-type': 'application/json' } });
            result = await response.json();
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        }
        assertCurrent();
        if (!response.ok) {
            const error = (result as { error?: unknown } | null)?.error;
            throw new Error(typeof error === 'string' ? error : `Agent 服务暂不可用（${response.status}）`);
        }
        return result;
    };
    return {
        request,
        async list(): Promise<MyAgentProfile[]> {
            const result = await request() as { agents: unknown[] };
            return result.agents.map(a => MyAgentProfileSchema.parse(a));
        },
        async get(id: string): Promise<MyAgentProfile> { return MyAgentProfileSchema.parse(await request(`/${id}`)); },
    };
}

export type MyAgentsApi = ReturnType<typeof createMyAgentsApi>;
