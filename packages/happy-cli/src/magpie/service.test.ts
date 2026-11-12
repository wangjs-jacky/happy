import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createMagpieService } from './service';

const id = createHash('sha256').update('codex\0person@example.test').digest('hex');
const account = (extra = {}) => ({ agent: 'codex', user: 'person@example.test', active: false, on: true,
    plan: 'pro', windows: [{ name: '7 days', remaining: 42, resetsAt: '2026-11-18T10:00:00Z' }], readAt: '2026-11-11T10:00:00Z', ...extra });
const ok = (data: unknown) => ({ exitCode: 0, timedOut: false, stdout: typeof data === 'string' ? data : JSON.stringify(data), stderr: '' });
function fixture() {
    const run = vi.fn().mockResolvedValue(ok([account()]));
    return { run, service: createMagpieService({ runner: { run }, resolve: async () => '/test/magpie' }) };
}
describe('Magpie device control', () => {
    it('returns a bounded metadata projection, never upstream secrets or raw errors', async () => {
        const { service, run } = fixture();
        run.mockResolvedValue(ok([account({ access_token: 'secret', error: 'Bearer private', alias: 'Work' })]));
        const result = await service.execute({ action: 'inspect' });
        expect(result.status).toBe('ready'); expect(result.accounts[0]).toMatchObject({ id, name: 'Work', quotaError: true });
        expect(JSON.stringify(result)).not.toMatch(/secret|Bearer private/);
        expect(run).toHaveBeenCalledOnce(); expect(run.mock.calls[0][1]).toEqual(['accounts', '--json']);
    });
    it('reports missing installation without trying any command', async () => {
        const run = vi.fn();
        const service = createMagpieService({ runner: { run }, resolve: async () => null });
        expect((await service.execute({ action: 'inspect' })).status).toBe('not-installed'); expect(run).not.toHaveBeenCalled();
    });
    it.each([
        { action: 'switch', accountId: id }, { action: 'rename', accountId: id, name: '--clear' },
        { action: 'rename', accountId: id, name: 'a\nb' }, { action: 'inspect', command: 'uninstall' },
    ])('rejects unconfirmed writes and command-shaped input before execution', async request => {
        const { service, run } = fixture();
        expect((await service.execute(request)).error).toBe('unsupported-action'); expect(run).not.toHaveBeenCalled();
    });
    it('does not write when a selected account has disappeared', async () => {
        const { service, run } = fixture(); run.mockResolvedValue(ok([]));
        expect((await service.execute({ action: 'switch', accountId: id, confirmed: true })).error).toBe('account-missing');
        expect(run).toHaveBeenCalledOnce();
    });
    it('refreshes one selected account and reads back instead of renewing all sign-ins', async () => {
        const { service, run } = fixture();
        expect((await service.execute({ action: 'refresh', accountId: id })).status).toBe('ready');
        expect(run.mock.calls.map(c => c[1])).toEqual([['accounts', '--json'], ['quota', 'refresh', 'codex', 'person@example.test', '--json'], ['accounts', '--json']]);
    });
    it('passes an alias as one literal argument and verifies the saved result', async () => {
        const { service, run } = fixture();
        const name = 'Work $(touch nope)';
        run.mockResolvedValueOnce(ok([account()])).mockResolvedValueOnce(ok('saved')).mockResolvedValueOnce(ok([account({ alias: name })]));
        const result = await service.execute({ action: 'rename', accountId: id, name });
        expect(result.status).toBe('ready'); expect(result.accounts[0].name).toBe(name);
        expect(run.mock.calls[1][1]).toEqual(['accounts', 'alias', 'codex', 'person@example.test', name]);
    });
    it('verifies a switch from the new active flag', async () => {
        const { service, run } = fixture();
        run.mockResolvedValueOnce(ok([account()])).mockResolvedValueOnce(ok('switched')).mockResolvedValueOnce(ok([account({ active: true })]));
        expect((await service.execute({ action: 'switch', accountId: id, confirmed: true })).accounts[0].active).toBe(true);
    });
    it('does not claim success when a write succeeds but the state does not change', async () => {
        const { service } = fixture();
        const result = await service.execute({ action: 'switch', accountId: id, confirmed: true });
        expect(result).toMatchObject({ status: 'error', error: 'verification-failed', changed: true, accounts: [] });
    });
    it('treats a timed out write as uncertain and never retries it', async () => {
        const { service, run } = fixture();
        run.mockResolvedValueOnce(ok([account()])).mockResolvedValueOnce({ ...ok(''), timedOut: true });
        expect((await service.execute({ action: 'rename', accountId: id, name: 'Work' })).error).toBe('verification-failed');
        expect(run).toHaveBeenCalledTimes(2);
    });
    it('rejects concurrent operations and recovers after completion', async () => {
        const { service, run } = fixture(); let finish!: (value: unknown) => void;
        run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const first = service.execute({ action: 'inspect' }); await Promise.resolve();
        expect((await service.execute({ action: 'inspect' })).error).toBe('busy');
        finish(ok([account()])); await first;
        expect((await service.execute({ action: 'inspect' })).status).toBe('ready');
    });
    it('rejects unknown shapes and flag-like account identifiers without leaking payloads', async () => {
        const { service, run } = fixture(); run.mockResolvedValue(ok([account({ user: '--next', token: 'private' })]));
        expect((await service.execute({ action: 'inspect' })).error).toBe('invalid-response');
        expect(run).toHaveBeenCalledOnce();
    });
});
