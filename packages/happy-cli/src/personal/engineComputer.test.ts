import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersonalComputerState } from '@slopus/happy-wire';
import { PersonalEngine } from './engine';
import { PersonalStore } from './store';
import type { PersonalComputerTools } from './tools';
import type { ChatMessage } from './model';

const model = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('./model', () => ({ completePersonalModel: model.complete }));

const temporary: string[] = [];
function temp() { const path = mkdtempSync(join(tmpdir(), 'paws-personal-engine-computer-')); temporary.push(path); return path; }
function fixture() {
    const state: PersonalComputerState = { available: true, phase: 'ready', control: 'agent', epoch: 0, width: 1280, height: 800 };
    const computer = {
        state: () => ({ ...state }),
        waitForAgentControl: vi.fn(async (_signal: AbortSignal) => {}),
        execute: vi.fn(async () => ({})), snapshot: vi.fn(async () => ({})),
        readFile: vi.fn(async () => 'sandbox'), writeFile: vi.fn(async () => ({})), runCommand: vi.fn(async () => ({})),
    } satisfies PersonalComputerTools;
    const options = { home: temp(), cwd: temp(), sessionId: 'fixture', computer, approve: async () => true,
        config: { baseUrl: 'http://127.0.0.1:1/v1', model: 'fixture', maxSteps: 4, executionTarget: 'docker' as const } };
    return { state, computer, options };
}
beforeEach(() => { model.complete.mockReset(); });
afterEach(() => { temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });

describe('Personal engine computer ownership', () => {
    it('refuses a missing Docker runtime or an implicit local-session migration', () => {
        const { options, computer } = fixture();
        expect(() => new PersonalEngine({ ...options, computer: undefined })).toThrow('host fallback');
        expect(() => new PersonalEngine({ ...options, config: { ...options.config, executionTarget: 'local' }, computer })).toThrow('cannot change execution target implicitly');
    });

    it('keeps host workspace instructions out of a new isolated-computer model context', async () => {
        const { options } = fixture();
        writeFileSync(join(options.cwd, 'AGENTS.md'), 'HOST_PROJECT_PRIVATE_INSTRUCTIONS');
        model.complete.mockResolvedValueOnce({ role: 'assistant', content: 'Ready.' });
        await new PersonalEngine(options).turn('hello', 'default', new AbortController().signal, () => {});
        const [, messages, definitions] = model.complete.mock.calls[0];
        expect(messages[0].content).toContain('trusted runtime executes the user\'s selected chrome-use');
        expect(messages[0].content).not.toContain('HOST_PROJECT_PRIVATE_INSTRUCTIONS');
        expect(messages[0].content).not.toContain(`Working directory: ${options.cwd}`);
        expect(definitions.map((definition: { function: { name: string } }) => definition.function.name)).toContain('browser_action');
    });

    it('makes no model request while the user owns the computer and cancels the event wait', async () => {
        const { state, computer, options } = fixture();
        state.control = 'human';
        let waiting!: () => void;
        const entered = new Promise<void>(resolve => { waiting = resolve; });
        computer.waitForAgentControl.mockImplementation(signal => new Promise((_resolve, reject) => {
            waiting(); signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        const abort = new AbortController();
        const turn = new PersonalEngine(options).turn('work', 'default', abort.signal, () => {});
        await entered;
        expect(model.complete).not.toHaveBeenCalled();
        abort.abort(new Error('cancelled test turn'));
        await expect(turn).rejects.toThrow('cancelled test turn');
        expect(computer.runCommand).not.toHaveBeenCalled();
    });

    it('does not execute a model plan generated before a human takeover', async () => {
        const { state, computer, options } = fixture();
        model.complete.mockImplementationOnce(async () => {
            state.epoch += 2; // The user took over, changed the page, then returned control.
            return { role: 'assistant', content: null, tool_calls: [{ id: 'stale', type: 'function', function: { name: 'run_command', arguments: '{"command":"echo stale plan"}' } }] };
        }).mockImplementationOnce(async (_config, messages: ChatMessage[]) => {
            expect(messages.at(-1)?.content).toContain('This action was not executed');
            return { role: 'assistant', content: 'I need a new observation.' };
        });
        await new PersonalEngine(options).turn('work', 'default', new AbortController().signal, () => {});
        expect(computer.runCommand).not.toHaveBeenCalled();
        const tool = new PersonalStore(options.home).transcript(options.sessionId).find(message => message.tool_call_id === 'stale');
        expect(tool?.content).toContain('Observe the computer again');
    });

    it('does not present a final answer generated against a stale computer state', async () => {
        const { state, options } = fixture();
        model.complete.mockImplementationOnce(async () => { state.epoch++; return { role: 'assistant', content: 'The old page is complete.' }; });
        const emit = vi.fn();
        await expect(new PersonalEngine(options).turn('finish', 'default', new AbortController().signal, emit)).rejects.toThrow('control changed');
        expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'The old page is complete.' }));
        expect(new PersonalStore(options.home).transcript(options.sessionId).at(-1)?.content).toContain('Response invalidated');
    });
});
