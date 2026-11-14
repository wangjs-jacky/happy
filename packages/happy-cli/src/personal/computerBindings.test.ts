import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersonalComputerState } from '@slopus/happy-wire';
import { loadPersonalConfig } from './config';
import { PersonalTools, personalComputerToolDefinitions, personalToolDefinitions, type PersonalComputerTools } from './tools';
import { PersonalStore } from './store';

const directories: string[] = [];
function temp() { const path = mkdtempSync(join(tmpdir(), 'paws-personal-binding-')); directories.push(path); return path; }
const signal = () => new AbortController().signal;
function runtime() {
    const state: PersonalComputerState = { available: true, phase: 'ready', control: 'agent', epoch: 0, width: 1280, height: 800 };
    const computer = {
        state: () => ({ ...state }),
        waitForAgentControl: vi.fn(async (_signal: AbortSignal) => {}),
        execute: vi.fn(async () => ({ ok: true })),
        snapshot: vi.fn(async () => ({ url: 'https://example.com/', text: 'Fresh sandbox observation' })),
        readFile: vi.fn(async () => 'SANDBOX_VALUE'),
        writeFile: vi.fn(async () => ({ written: '/workspace/result.txt' })),
        runCommand: vi.fn(async () => ({ stdout: 'sandbox', stderr: '' })),
    } satisfies PersonalComputerTools;
    return { state, computer };
}
afterEach(() => { directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); vi.unstubAllEnvs(); });

describe('Personal execution target compatibility', () => {
    it('keeps existing configuration local and accepts explicit docker', () => {
        const home = temp();
        vi.stubEnv('PAWS_PERSONAL_HOME', home);
        vi.stubEnv('PAWS_PERSONAL_BASE_URL', 'http://127.0.0.1:12345/v1');
        vi.stubEnv('PAWS_PERSONAL_EXECUTION_TARGET', '');
        expect(loadPersonalConfig().executionTarget).toBe('local');
        writeFileSync(join(home, 'config.json'), JSON.stringify({ executionTarget: 'docker' }));
        expect(loadPersonalConfig().executionTarget).toBe('docker');
        vi.stubEnv('PAWS_PERSONAL_EXECUTION_TARGET', 'typo-target');
        expect(() => loadPersonalConfig()).toThrow();
    });

    it('does not advertise isolated browser tools to a local session', async () => {
        expect(personalToolDefinitions.map(tool => tool.function.name)).not.toContain('browser_action');
        expect(personalComputerToolDefinitions.map(tool => tool.function.name)).toContain('browser_action');
        const tools = new PersonalTools(temp(), new PersonalStore(temp()), [], async () => true);
        await expect(tools.execute('not-local', 'browser_snapshot', {}, 'yolo', signal())).rejects.toThrow('Unknown Personal tool');
    });
});

describe('Personal isolated execution boundaries', () => {
    it('routes reads, writes and shell exclusively to the computer, leaving host files untouched', async () => {
        const cwd = temp(), { computer } = runtime();
        writeFileSync(join(cwd, 'input.txt'), 'HOST_SECRET');
        const approve = vi.fn(async () => true);
        const tools = new PersonalTools(cwd, new PersonalStore(temp()), [], approve, computer);
        expect(await tools.execute('r', 'read_file', { path: 'input.txt' }, 'default', signal())).toBe('SANDBOX_VALUE');
        await tools.execute('w', 'write_file', { path: 'result.txt', content: 'sandbox only' }, 'default', signal());
        await tools.execute('x', 'run_command', { command: `touch '${join(cwd, 'must-not-exist')}'` }, 'default', signal());
        expect(computer.readFile).toHaveBeenCalledWith('input.txt', expect.any(AbortSignal));
        expect(computer.writeFile).toHaveBeenCalledWith('result.txt', 'sandbox only', expect.any(AbortSignal));
        expect(computer.runCommand).toHaveBeenCalledTimes(1);
        expect(approve).toHaveBeenCalledTimes(2);
        expect(existsSync(join(cwd, 'result.txt'))).toBe(false);
        expect(existsSync(join(cwd, 'must-not-exist'))).toBe(false);
        expect(readFileSync(join(cwd, 'input.txt'), 'utf8')).toBe('HOST_SECRET');
    });

    it('does not fall back to the host when the computer is stopped or a runtime call fails', async () => {
        const cwd = temp(), { computer, state } = runtime();
        const tools = new PersonalTools(cwd, new PersonalStore(temp()), [], async () => true, computer);
        state.phase = 'stopped';
        await expect(tools.execute('x', 'run_command', { command: 'echo no' }, 'yolo', signal())).rejects.toThrow('not ready');
        expect(computer.runCommand).not.toHaveBeenCalled();
        expect(await tools.execute('m', 'memory_read', {}, 'read-only', signal())).toEqual({});
        state.phase = 'ready';
        computer.writeFile.mockRejectedValueOnce(new Error('container unavailable'));
        await expect(tools.execute('w', 'write_file', { path: 'absent.txt', content: 'no' }, 'yolo', signal())).rejects.toThrow('container unavailable');
        expect(existsSync(join(cwd, 'absent.txt'))).toBe(false);
    });

    it('gates browser input and returns a fresh observation only after the approved action', async () => {
        const { computer } = runtime(), approve = vi.fn(async () => false);
        const tools = new PersonalTools(temp(), new PersonalStore(temp()), [], approve, computer);
        const args = { input: { kind: 'navigate', url: 'https://example.com/' } };
        await expect(tools.execute('read-only', 'browser_action', args, 'read-only', signal())).rejects.toThrow('read-only');
        await expect(tools.execute('denied', 'browser_action', args, 'default', signal())).rejects.toThrow('declined');
        expect(computer.execute).not.toHaveBeenCalled();
        approve.mockResolvedValue(true);
        const result = await tools.execute('allowed', 'browser_action', args, 'default', signal());
        expect(result).toEqual({ url: 'https://example.com/', text: 'Fresh sandbox observation' });
        expect(computer.execute.mock.invocationCallOrder[0]).toBeLessThan(computer.snapshot.mock.invocationCallOrder[0]);
    });

    it('waits on human control and rejects the old action after control is returned', async () => {
        const { computer, state } = runtime();
        state.control = 'human'; state.epoch = 1;
        let release!: () => void;
        computer.waitForAgentControl.mockImplementationOnce(() => new Promise<void>(resolve => { release = () => { state.control = 'agent'; state.epoch++; resolve(); }; }));
        const tools = new PersonalTools(temp(), new PersonalStore(temp()), [], async () => true, computer);
        const pending = tools.execute('old-input', 'browser_action', { input: { kind: 'click', x: 1, y: 1 } }, 'yolo', signal());
        await Promise.resolve();
        expect(computer.execute).not.toHaveBeenCalled();
        release();
        await expect(pending).rejects.toThrow('control changed');
        expect(computer.execute).not.toHaveBeenCalled();
        await tools.execute('new-observation', 'browser_snapshot', {}, 'read-only', signal());
        expect(computer.snapshot).toHaveBeenCalledTimes(1);
    });

    it('does not execute an old approval or return a stale result across an epoch change', async () => {
        const { computer, state } = runtime();
        let grant!: (allowed: boolean) => void;
        let requested!: () => void;
        const approvalRequested = new Promise<void>(resolve => { requested = resolve; });
        const approve = () => new Promise<boolean>(resolve => { grant = resolve; requested(); });
        const tools = new PersonalTools(temp(), new PersonalStore(temp()), [], approve, computer);
        const pending = tools.execute('approved-after-edit', 'run_command', { command: 'echo old plan' }, 'default', signal());
        await approvalRequested;
        state.epoch += 2;
        grant(true);
        await expect(pending).rejects.toThrow('control changed');
        expect(computer.runCommand).not.toHaveBeenCalled();
        computer.readFile.mockImplementationOnce(async () => { state.epoch++; return 'STALE'; });
        await expect(tools.execute('r', 'read_file', { path: 'input.txt' }, 'default', signal())).rejects.toThrow('control changed');
    });
});
