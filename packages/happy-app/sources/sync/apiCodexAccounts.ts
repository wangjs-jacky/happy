import { z } from 'zod';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import { getHappyClientId } from './apiSocket';

// Mirror only the App-facing server contract. Credential upload/redemption is daemon-only.
const timestamp = z.string().datetime({ offset: true });
const version = z.number().int().nonnegative();
const profileSchema = z.object({
    id: z.string().uuid(), displayName: z.string(),
    status: z.enum(['available', 'needs-refresh', 'invalid']), credentialVersion: version,
    createdAt: timestamp, updatedAt: timestamp, lastValidatedAt: timestamp.nullable(),
    quota: z.object({
        state: z.enum(['unknown', 'current', 'stale', 'reset']),
        remainingPercent: z.number().min(0).max(100).nullable(),
        weeklyResetsAt: timestamp.nullable(), observedAt: timestamp.nullable(),
    }),
});
const bindingSchema = z.object({ machineId: z.string(), profileId: z.string().uuid().nullable(), version });
const listSchema = z.object({
    profiles: z.array(profileSchema), bindings: z.array(bindingSchema),
    migration: z.enum(['none', 'completed', 'needs-upload']),
});
const grantSchema = z.object({
    grant: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: timestamp,
    profile: profileSchema.pick({ id: true, displayName: true, credentialVersion: true }),
});

export type CodexAccountProfile = z.infer<typeof profileSchema>;
export type CodexMachineBinding = z.infer<typeof bindingSchema>;
export type ListCodexAccountsResponse = z.infer<typeof listSchema>;
export type CodexSessionGrant = z.infer<typeof grantSchema>;

const errorMessages = {
    'codex-account-unbound': 'Bind a Codex account to this machine in Settings → Codex accounts before starting a session.',
    'codex-account-unavailable': 'The bound Codex account needs attention. Refresh the login and run paws codex account upload, or bind another account.',
    'binding-version-conflict': 'This machine’s Codex binding changed. Refresh the account list and try again.',
    'display-name-conflict': 'This Codex account name is already in use. Choose another name.',
    'profile-not-found': 'This Codex account was removed. Refresh the account list and bind an available account.',
    'machine-not-found': 'This machine is no longer available. Refresh the machine list.',
    'invalid-request': 'The Codex account request is invalid. Check the entered values.',
    'grant-unavailable': 'The Codex session authorization expired or the binding changed. Start the session again.',
    'codex-account-operation-failed': 'Codex account operation failed. Try again.',
    'authentication-required': 'Sign in to Paws before using Codex accounts.',
    'network-error': 'Unable to reach Codex accounts. Check the network and try again.',
    'invalid-response': 'Invalid Codex account response. Check the server version.',
    'https-required': 'Codex accounts require an HTTPS server connection.',
} as const;
export type CodexAccountErrorCode = keyof typeof errorMessages;

export class CodexAccountError extends Error {
    constructor(public readonly code: CodexAccountErrorCode, public readonly status?: number) {
        super(errorMessages[code]);
        this.name = 'CodexAccountError';
    }
}

function accountServerUrl(): string {
    const configured = getServerUrl().replace(/\/$/, '');
    if (configured === 'http://47.115.228.20:3005') return 'https://47.115.228.20:8443';
    const url = new URL(configured);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
        throw new CodexAccountError('https-required');
    }
    return configured;
}

async function request<T>(credentials: AuthCredentials, path: string, method: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const url = `${accountServerUrl()}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(url, {
            method, redirect: 'error', cache: 'no-store', signal: controller.signal,
            headers: {
                Authorization: `Bearer ${credentials.token}`, 'X-Happy-Client': getHappyClientId(),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            const code = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
            throw new CodexAccountError(
                response.status === 401 ? 'authentication-required' :
                    typeof code === 'string' && Object.hasOwn(errorMessages, code)
                        ? code as CodexAccountErrorCode : 'codex-account-operation-failed',
                response.status,
            );
        }
        // Strip unknown properties; never let response extras reach UI state or error logs.
        const parsed = schema.safeParse(data);
        if (!parsed.success) throw new CodexAccountError('invalid-response', response.status);
        return parsed.data;
    } catch (error) {
        if (error instanceof CodexAccountError) throw error;
        // Fetch/parse exceptions can contain response/request data. Do not retain a cause.
        throw new CodexAccountError('network-error');
    } finally {
        clearTimeout(timeout);
    }
}

export function listCodexAccounts(credentials: AuthCredentials): Promise<ListCodexAccountsResponse> {
    return request(credentials, '/v1/codex-accounts', 'GET', listSchema);
}
export function renameCodexAccount(credentials: AuthCredentials, profileId: string, displayName: string) {
    return request(credentials, `/v1/codex-accounts/${encodeURIComponent(profileId)}`, 'PATCH', z.object({ profile: profileSchema }), { displayName });
}
export function deleteCodexAccount(credentials: AuthCredentials, profileId: string) {
    return request(credentials, `/v1/codex-accounts/${encodeURIComponent(profileId)}`, 'DELETE', z.object({ success: z.literal(true) }));
}
export function bindCodexAccount(credentials: AuthCredentials, machineId: string, binding: { profileId: string | null; expectedVersion: number }) {
    return request(credentials, `/v1/machines/${encodeURIComponent(machineId)}/codex-account`, 'PUT', z.object({ binding: bindingSchema }),
        { profileId: binding.profileId, expectedVersion: binding.expectedVersion });
}
export function createCodexSessionGrant(credentials: AuthCredentials, machineId: string): Promise<CodexSessionGrant> {
    // No retries or caching: every final spawn attempt uses a new one-time grant.
    return request(credentials, '/v1/codex-session-grants', 'POST', grantSchema, { machineId });
}
