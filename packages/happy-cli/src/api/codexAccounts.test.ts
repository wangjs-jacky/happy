import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { ApiClient } from './api';
import { configuration } from '@/configuration';
vi.mock('axios', () => ({ default: { request: vi.fn(), isAxiosError: (e: any) => !!e?.isAxiosError } }));
const credentials = { token: 'paws-secret', encryption: { type: 'legacy' as const, secret: new Uint8Array(32) } };
const mutableConfiguration = configuration as { serverUrl: string };
const auth = { tokens: { id_token: 'id-secret', access_token: 'access-secret', refresh_token: 'refresh-secret', account_id: 'account-secret' } };
describe('Codex credential API transport', () => {
  it.each([
    ['http://47.115.228.20:3005', 'https://47.115.228.20:8443'],
    ['https://paws.example', 'https://paws.example'],
    ['http://127.0.0.1:3333', 'http://127.0.0.1:3333'],
  ])('posts credentials securely for %s', async (base, expected) => {
    const saved = configuration.serverUrl; mutableConfiguration.serverUrl = base;
    try {
      vi.mocked(axios.request).mockResolvedValue({ data: { profile: { id: 'p1' } } });
      const api = await ApiClient.create(credentials); await api.uploadCodexAccount(auth);
      expect(axios.request).toHaveBeenLastCalledWith(expect.objectContaining({
        url: expected + '/v1/codex-accounts/upload', method: 'POST', data: { auth },
        maxRedirects: 0, headers: expect.objectContaining({ Authorization: 'Bearer paws-secret' }),
      }));
      expect(configuration.serverUrl).toBe(base);
    } finally { mutableConfiguration.serverUrl = saved; }
  });
  it('refuses other plaintext remote endpoints before sending credentials', async () => {
    const saved = configuration.serverUrl; mutableConfiguration.serverUrl = 'http://remote.example'; vi.mocked(axios.request).mockClear();
    try { await expect((await ApiClient.create(credentials)).uploadCodexAccount(auth)).rejects.toThrow('HTTPS'); expect(axios.request).not.toHaveBeenCalled(); }
    finally { mutableConfiguration.serverUrl = saved; }
  });
  it('uses the grant only in the POST body and replaces transport errors with safe codes', async () => {
    vi.mocked(axios.request).mockRejectedValue({ isAxiosError: true, message: 'secret-canary', config: { data: auth }, response: { status: 409, data: { error: 'grant-unavailable' } } });
    const api = await ApiClient.create(credentials);
    await expect(api.redeemCodexSessionGrant({ machineId: 'm1', grant: 'opaque-canary' })).rejects.toThrow('grant-unavailable');
    const request = vi.mocked(axios.request).mock.calls.at(-1)![0];
    expect(request.url).toMatch(/\/v1\/codex-session-grants\/redeem$/);
    expect(request.url).not.toContain('canary');
    expect(request.data).toEqual({ machineId: 'm1', grant: 'opaque-canary' });
    vi.mocked(axios.request).mockRejectedValue(new Error('secret-canary'));
    await expect(api.uploadCodexAccount(auth)).rejects.toThrow('codex-account-request-failed');
  });
});
