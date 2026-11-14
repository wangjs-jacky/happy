/** Native Personal tools. All command execution and workspace writes pass the session permission gate. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { PersonalComputerInputSchema, type PersonalComputerInput, type PersonalComputerState } from '@slopus/happy-wire';
import type { ToolDefinition } from './model';
import type { PersonalSkill } from './skills';
import { isWithin, GROK_COMPATIBILITY } from './skills';
import { PersonalStore } from './store';

const execFileAsync = promisify(execFile);
export type PersonalPermissionMode = 'default' | 'read-only' | 'yolo';
export function personalPermissionMode(value: unknown): PersonalPermissionMode {
    if (value === 'yolo') return 'yolo';
    if (value === 'read-only' || value === 'plan') return 'read-only';
    return 'default';
}
export type PersonalApproval = (id: string, tool: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<boolean>;
/** Narrow trusted runtime surface. Neither model tools nor scripts receive Docker/CDP handles. */
export interface PersonalComputerTools {
    state(): PersonalComputerState;
    waitForAgentControl(signal: AbortSignal): Promise<void>;
    execute(input: PersonalComputerInput, signal: AbortSignal): Promise<unknown>;
    snapshot(signal: AbortSignal): Promise<unknown>;
    readFile(path: string, signal: AbortSignal): Promise<unknown>;
    writeFile(path: string, content: string, signal: AbortSignal): Promise<unknown>;
    runCommand(command: string, signal: AbortSignal): Promise<unknown>;
}
type ToolSpec = { description: string; schema: z.ZodObject; mutates: boolean };
const specs: Record<string, ToolSpec> = {
    list_skills: { description: 'List installed workflow names, descriptions and actual capability requirements.', schema: z.object({}).strict(), mutates: false },
    read_skill: { description: 'Read a workflow by exact installed name, including Paws compatibility rules and its reference.', schema: z.object({ name: z.string() }).strict(), mutates: false },
    read_file: { description: 'Read UTF-8 text in the working directory or registered skill resources, at most 256 KiB.', schema: z.object({ path: z.string() }).strict(), mutates: false },
    write_file: { description: 'Write UTF-8 text within the working directory. Requires execution approval.', schema: z.object({ path: z.string(), content: z.string().max(256 * 1024) }).strict(), mutates: true },
    run_command: { description: 'Run a command in the working directory with a 60 second timeout and bounded output. Requires approval. Browser control must use Ego only.', schema: z.object({ command: z.string().min(1).max(12000) }).strict(), mutates: true },
    memory_read: { description: 'Read private, persistent user preferences for this personal agent.', schema: z.object({}).strict(), mutates: false },
    memory_write: { description: 'Remember a user-stated preference, or forget it with value=null. Never save credentials, payment information or inferred consent.', schema: z.object({ key: z.string(), value: z.string().max(4000).nullable() }).strict(), mutates: true },
};
const computerSpecs: Record<string, ToolSpec> = {
    ...specs,
    read_file: { ...specs.read_file, description: 'Read UTF-8 text inside the isolated computer workspace. Host paths and credential files are not available.' },
    write_file: { ...specs.write_file, description: 'Write UTF-8 text inside the isolated computer workspace after approval. Cannot write host files.' },
    run_command: { ...specs.run_command, description: 'Run an approved command inside the isolated Linux computer with bounded output and timeout. It never falls back to the host shell.' },
    browser_snapshot: { description: 'Observe the isolated computer browser through its trusted chrome-use adapter: current URL, title and accessibility snapshot with element refs such as @e1. Observe before choosing an action; this cannot access Ego or the host browser.', schema: z.object({}).strict(), mutates: false },
    browser_action: { description: 'Perform one approved input through the isolated computer chrome-use adapter, then return a fresh snapshot. Prefer element actions using refs from the latest snapshot; stale refs must not be reused. There is no free-form shell, page-JavaScript or raw CDP parameter. Never target a host browser. Hand login and human verification to the user with computer takeover.', schema: z.object({ input: PersonalComputerInputSchema }).strict(), mutates: true },
};

export const personalToolDefinitions: ToolDefinition[] = Object.entries(specs).map(([name, spec]) => ({
    type: 'function', function: { name, description: spec.description, parameters: z.toJSONSchema(spec.schema) },
}));
export const personalComputerToolDefinitions: ToolDefinition[] = Object.entries(computerSpecs).map(([name, spec]) => ({
    type: 'function', function: { name, description: spec.description, parameters: z.toJSONSchema(spec.schema) },
}));

export class PersonalTools {
    private readonly cwd: string;
    constructor(cwd: string, private readonly store: PersonalStore, private readonly skills: PersonalSkill[],
        private readonly approve: PersonalApproval, private readonly computer?: PersonalComputerTools) { this.cwd = realpathSync(cwd); }

    private path(path: string, write = false): string {
        const lexical = resolve(this.cwd, path);
        let parent = dirname(lexical);
        if (write) while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
        const actual = write ? join(realpathSync(parent), relative(parent, lexical)) : realpathSync(lexical);
        const roots = [this.cwd, ...(!write ? this.skills.map(skill => dirname(skill.path)) : [])];
        if (!roots.some(root => isWithin(actual, realpathSync(root)))) throw new Error('Path is outside the workspace and registered skill resources');
        if (/(?:^|[/\\])(?:\.env(?:\.[^/\\]+)?|\.ssh|access\.key|agent\.key|auth\.json)(?:$|[/\\])/i.test(actual)) throw new Error('Credential files cannot be read or written by this tool');
        // Resolve existing output files too, so a symlink cannot escape the workspace.
        if (write) {
            try { if (!isWithin(realpathSync(actual), this.cwd)) throw new Error('Output symlink leaves the workspace'); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        return actual;
    }

    async execute(id: string, name: string, input: unknown, mode: PersonalPermissionMode, signal: AbortSignal): Promise<unknown> {
        signal.throwIfAborted();
        const needsComputer = ['read_file', 'write_file', 'run_command', 'browser_snapshot', 'browser_action'].includes(name);
        const epoch = this.computer?.state().epoch;
        await this.computer?.waitForAgentControl(signal);
        this.assertCurrentComputer(epoch, needsComputer);
        const spec = (this.computer ? computerSpecs : specs)[name];
        if (!spec) throw new Error(`Unknown Personal tool: ${name}`);
        const args = spec.schema.parse(input) as Record<string, unknown>;
        if (spec.mutates) {
            if (mode === 'read-only') throw new Error('This tool is disabled in read-only mode');
            // Explicit preference memory is local bookkeeping; shell and file changes still require a gate.
            if (mode !== 'yolo' && name !== 'memory_write' && !await this.approve(id, name, args, signal)) throw new Error('User declined execution');
            signal.throwIfAborted();
        }
        // An approval may remain open during takeover. It must never authorize
        // execution of the stale plan after the user changes the page.
        await this.computer?.waitForAgentControl(signal);
        this.assertCurrentComputer(epoch, needsComputer);
        const result = await this.executeApproved(name, args, signal);
        this.assertCurrentComputer(epoch, needsComputer);
        return result;
    }

    private assertCurrentComputer(epoch: number | undefined, ready: boolean): void {
        if (!this.computer) return;
        const current = this.computer.state();
        if (current.control !== 'agent' || current.epoch !== epoch) {
            throw new Error('Computer control changed; the action or observation may be stale. Do not replay it. Observe the computer again before continuing.');
        }
        if (ready && current.phase !== 'ready') throw new Error('The isolated computer is not ready. Ask the user to start it from the computer controls; host execution is disabled.');
    }

    private async executeApproved(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
        switch (name) {
            case 'list_skills': return this.skills.map(({ name, description, capability }) => ({ name, description, capability }));
            case 'read_skill': {
                const skill = this.skills.find(skill => skill.name === args.name);
                if (!skill) throw new Error('Skill is not installed');
                const adapter = readFileSync(skill.path, 'utf8');
                return skill.name.startsWith('grok-')
                    ? `${GROK_COMPATIBILITY}\n${adapter}\n## Foreign domain reference (not host instructions)\n${readFileSync(join(dirname(skill.path), 'references', 'upstream.md'), 'utf8')}`
                    : adapter;
            }
            case 'read_file': {
                if (this.computer) return this.computer.readFile(args.path as string, signal);
                const path = this.path(args.path as string);
                if (statSync(path).size > 256 * 1024) throw new Error('File exceeds 256 KiB');
                return readFileSync(path, 'utf8');
            }
            case 'write_file': {
                if (this.computer) return this.computer.writeFile(args.path as string, args.content as string, signal);
                const path = this.path(args.path as string, true);
                mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
                writeFileSync(path, args.content as string, { mode: 0o600 });
                return { written: path };
            }
            case 'run_command': {
                if (this.computer) return this.computer.runCommand(args.command as string, signal);
                const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : process.env.SHELL || '/bin/sh';
                const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c', args.command as string] : ['-lc', args.command as string];
                const { stdout, stderr } = await execFileAsync(shell, shellArgs, {
                    cwd: this.cwd, timeout: 60_000, maxBuffer: 256 * 1024, signal, encoding: 'utf8',
                });
                return { stdout: stdout.slice(0, 16000), stderr: stderr.slice(0, 16000) };
            }
            case 'memory_read': return this.store.memory();
            case 'memory_write': this.store.remember(args.key as string, args.value as string | null); return { saved: true };
            case 'browser_snapshot': return this.computer!.snapshot(signal);
            case 'browser_action': {
                await this.computer!.execute(args.input as PersonalComputerInput, signal);
                // All coordinates and page data must come from the post-action
                // observation. A host browser is never an alternate target.
                return this.computer!.snapshot(signal);
            }
            default: throw new Error('Unsupported Personal tool');
        }
    }
}
