import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handlePersonalCommand } from './command';

const mocks = vi.hoisted(() => ({ request: vi.fn(), dispose: vi.fn(), turn: vi.fn(), engine: vi.fn(), auth: vi.fn(), run: vi.fn() }));
vi.mock('@/ui/auth', () => ({ authAndSetupMachineIfNeeded: mocks.auth }));
vi.mock('./runPersonal', () => ({ runPersonal: mocks.run }));
vi.mock('./engine', () => ({ PersonalEngine: class {
    constructor(options: unknown) { mocks.engine(options); }
    turn = mocks.turn;
} }));
vi.mock('./computer', () => ({ PersonalComputer: class {
    request = mocks.request;
    dispose = mocks.dispose;
} }));

let home: string;
beforeEach(() => {
    vi.clearAllMocks();
    home = mkdtempSync(join(tmpdir(), 'paws-personal-command-computer-'));
    vi.stubEnv('PAWS_PERSONAL_HOME', home);
    vi.stubEnv('PAWS_PERSONAL_EXECUTION_TARGET', 'local');
    mocks.request.mockResolvedValue({ state: { available: true, phase: 'ready', control: 'agent', epoch: 7, width: 1280, height: 800 } });
    mocks.turn.mockResolvedValue(undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Personal computer CLI boundaries', () => {
    it('runs lifecycle status without reading model configuration or logging in', async () => {
        writeFileSync(join(home, 'config.json'), 'invalid JSON proves this command does not load model configuration');
        await handlePersonalCommand(['computer', 'status']);
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith({ action: 'status' });
        expect(mocks.auth).not.toHaveBeenCalled();
        expect(mocks.engine).not.toHaveBeenCalled();
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });

    it('binds stop to the freshly read control epoch', async () => {
        await handlePersonalCommand(['computer', 'stop']);
        expect(mocks.request.mock.calls.map(call => call[0])).toEqual([{ action: 'status' }, { action: 'stop', epoch: 7 }]);
    });

    it('does not auto-start the computer or persist an execution-target override for print', async () => {
        vi.stubEnv('PAWS_PERSONAL_BASE_URL', 'http://127.0.0.1:12345/v1');
        await handlePersonalCommand(['--execution-target', 'docker', '--print', 'hello']);
        expect(mocks.request).toHaveBeenCalledExactlyOnceWith({ action: 'status' });
        expect(mocks.engine).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ executionTarget: 'docker' }), computer: expect.any(Object) }));
        expect(mocks.dispose).toHaveBeenCalledOnce();
        expect(process.env.PAWS_PERSONAL_EXECUTION_TARGET).toBe('local');
    });

    it('refuses implicit migration of a resumed conversation before any login or execution', async () => {
        await expect(handlePersonalCommand(['--execution-target', 'docker', '--resume', 'old-thread'])).rejects.toThrow('Cannot change an existing');
        expect(mocks.auth).not.toHaveBeenCalled();
        expect(mocks.run).not.toHaveBeenCalled();
        expect(process.env.PAWS_PERSONAL_EXECUTION_TARGET).toBe('local');
    });
});
