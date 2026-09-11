import { describe, expect, it, vi } from 'vitest';
import { uploadCurrentCodexAccount } from './codexAccountUpload';

const auth = { tokens: { id_token: 'secret-id', access_token: 'secret-access', refresh_token: 'secret-refresh', account_id: 'secret-account' } };
function dependencies() {
  return {
    readCredentials: vi.fn(async () => ({ token: 'paws-secret', encryption: { type: 'legacy' as const, secret: new Uint8Array(32) } })),
    readAuth: vi.fn(async () => auth),
    upload: vi.fn(async () => ({ profile: { displayName: 'Codex · ABCD', status: 'available' } })),
    confirm: vi.fn(async () => true), isInteractive: () => true,
    output: vi.fn(), serverUrl: 'https://paws.example',
  };
}
describe('uploadCurrentCodexAccount', () => {
  it('requires confirmation and uploads the local record using the signed-in Paws identity without printing secrets', async () => {
    const d = dependencies(); await uploadCurrentCodexAccount(d);
    expect(d.upload).toHaveBeenCalledWith(await d.readCredentials(), auth);
    expect(d.confirm.mock.invocationCallOrder[0]).toBeLessThan(d.upload.mock.invocationCallOrder[0]);
    expect(JSON.stringify(d.output.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(d.output.mock.calls)).toContain('Codex · ABCD');
  });
  it('refuses noninteractive upload', async () => {
    const d = dependencies(); d.isInteractive = () => false;
    await expect(uploadCurrentCodexAccount(d)).rejects.toThrow('interactive');
    expect(d.upload).not.toHaveBeenCalled();
  });
  it('gives login instructions without invoking login or uploading', async () => {
    const d = dependencies(); d.readCredentials.mockResolvedValue(null as any);
    await expect(uploadCurrentCodexAccount(d)).rejects.toThrow('paws auth login');
    expect(d.readAuth).not.toHaveBeenCalled(); expect(d.upload).not.toHaveBeenCalled();
  });
  it('does not upload on invalid auth or declined confirmation', async () => {
    const d = dependencies(); d.confirm.mockResolvedValue(false);
    await uploadCurrentCodexAccount(d); expect(d.upload).not.toHaveBeenCalled();
    d.readAuth.mockRejectedValue(new Error('Invalid Codex auth.json'));
    await expect(uploadCurrentCodexAccount(d)).rejects.toThrow('Invalid Codex');
    expect(d.upload).not.toHaveBeenCalled();
  });
});
