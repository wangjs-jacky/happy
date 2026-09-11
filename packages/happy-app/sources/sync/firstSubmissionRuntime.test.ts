import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC, alert } = vi.hoisted(() => ({ machineRPC: vi.fn(), alert: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000002' }));
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC }, getHappyClientId: () => 'web' }));
vi.mock('./serverConfig', () => ({ getServerUrl: () => 'https://test' }));
vi.mock('@/auth/tokenStorage', () => ({ TokenStorage: { getCredentials: async () => ({ token: 'bearer', secret: 'secret' }) } }));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('@/hooks/useSpawnSession', () => ({ configureSpawnedSession: vi.fn() }));
vi.mock('@/modal', () => ({ Modal: { alert, confirm: vi.fn() } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./sessionStartupTrace', () => ({ traceStartup: vi.fn() }));
vi.mock('./sessionStartupTraceRuntime', () => ({ sessionStartupTraceRuntime: { begin: vi.fn(), bindSession: vi.fn() } }));

import { firstSubmission } from './firstSubmissionRuntime';
import { clearFirstSubmissionScope, setFirstSubmissionScope } from './firstSubmissionScope';

const input = { text: 'hello', prompt: 'hello', machineId: 'machine-1', path: '/repo',
    agent: 'codex' as const, worktreeKey: null, attachments: [] };
let saved: Map<string, string>;
beforeEach(() => {
    saved = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => saved.get(key) ?? null,
        setItem: (key: string, value: string) => saved.set(key, value),
    });
    machineRPC.mockReset(); alert.mockReset();
    setFirstSubmissionScope('account/server', 'https://test');
});
afterEach(() => { clearFirstSubmissionScope(); vi.unstubAllGlobals(); });

describe('first submission launch errors', () => {
    it.each([
        ['codex-account-unbound', /bind.*machine/i],
        ['codex-account-unavailable', /paws codex account upload/i],
    ])('surfaces actionable %s through the actual owner/runtime/ops flow without persisting it', async (error, instruction) => {
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error, auth: 'must-not-escape' }), { status: 409 }));

        expect(await firstSubmission.submit(input, { images: [] })).toBe(false);

        expect(firstSubmission.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'spawn', text: 'hello' });
        expect(alert).toHaveBeenCalledWith('common.error', expect.stringMatching(instruction));
        expect(alert.mock.calls[0][1]).toContain('machine-1');
        expect(alert.mock.calls[0][1]).toContain('spawn-happy-session');
        expect(alert.mock.calls[0][1]).not.toContain('must-not-escape');
        expect(machineRPC).not.toHaveBeenCalled();
        expect([...saved.values()].join('')).not.toContain(error);
        expect([...saved.values()].join('')).not.toContain('must-not-escape');
        expect(JSON.stringify(firstSubmission.getSnapshot())).not.toContain(error);
    });

    it('shows the generic fallback for an empty launch error and never persists the grant', async () => {
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ grant: 'a'.repeat(43),
            expiresAt: '2026-09-11T00:01:00Z', profile: { id: '00000000-0000-4000-8000-000000000001', displayName: 'Work', credentialVersion: 1 } })));
        machineRPC.mockResolvedValue({ type: 'error', errorMessage: '' });

        expect(await firstSubmission.submit(input, { images: [] })).toBe(false);

        expect(alert).toHaveBeenCalledWith('common.error', 'newSession.submissionFailed');
        expect(firstSubmission.getSnapshot()).toMatchObject({ phase: 'failed', failure: 'spawn' });
        expect([...saved.values()].join('')).not.toContain('a'.repeat(43));
        expect(JSON.stringify(firstSubmission.getSnapshot())).not.toContain('a'.repeat(43));
    });

    it('does not show a late launch error after switching accounts', async () => {
        let resolve!: (response: Response) => void;
        vi.stubGlobal('fetch', () => new Promise<Response>((done) => { resolve = done; }));
        const submitted = firstSubmission.submit(input, { images: [] });
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
        setFirstSubmissionScope('other-account/server', 'https://test');
        resolve(new Response(JSON.stringify({ error: 'codex-account-unbound' }), { status: 409 }));
        expect(await submitted).toBe(false);
        expect(alert).not.toHaveBeenCalled();
        expect(firstSubmission.getSnapshot()).toBeNull();
    });
});
