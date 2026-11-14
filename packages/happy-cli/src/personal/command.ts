/** CLI entry for installing skills, inspecting capabilities, a local turn, or an encrypted Paws session. */
import { randomUUID } from 'node:crypto';
import { authAndSetupMachineIfNeeded } from '@/ui/auth';
import { loadPersonalConfig, personalHome, PersonalExecutionTargetSchema } from './config';
import { importGrokSkills, listPersonalSkills } from './skills';
import { PersonalEngine } from './engine';
import { runPersonal } from './runPersonal';
import { personalPermissionMode } from './tools';

export async function handlePersonalCommand(args: string[]): Promise<void> {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`Paws Personal — native personal agent\n\npaws personal [--execution-target local|docker]\npaws personal install-skills <grok-bot-skills.zip>\npaws personal skills\npaws personal computer start|status|stop\npaws personal --print <prompt> [--permission-mode read-only|default|yolo] [--execution-target local|docker]\n\nConfigure ~/.happy/personal-agent/config.json with baseUrl, model, optional apiKeyEnv and executionTarget,\nor PAWS_PERSONAL_BASE_URL, PAWS_PERSONAL_MODEL, PAWS_PERSONAL_API_KEY and PAWS_PERSONAL_EXECUTION_TARGET.\nExecution defaults to local for existing installations. Docker never falls back to the host shell.\nComputer lifecycle commands do not need a model API key; start is an explicit user action.\nPersonal never requires Codex, Claude, OpenCode or OpenClaw.\n`);
        return;
    }
    const home = personalHome();
    if (args[0] === 'computer') {
        const action = args[1];
        if (args.length !== 2 || !['start', 'status', 'stop'].includes(action)) throw new Error('Usage: paws personal computer start|status|stop');
        // Import the runtime only for computer-aware paths. Existing local
        // installs neither need Docker nor load a browser implementation.
        const { PersonalComputer } = await import('./computer');
        const computer = new PersonalComputer({ home, onFrame: () => {} });
        try {
            const result = action === 'stop'
                ? await computer.request({ action: 'stop', epoch: (await computer.request({ action: 'status' })).state.epoch })
                : await computer.request({ action: action as 'start' | 'status' });
            console.log(JSON.stringify(result.state, null, 2));
        } finally { await computer.dispose(); }
        return;
    }
    if (args[0] === 'install-skills') {
        if (args.length !== 2) throw new Error('Usage: paws personal install-skills <archive.zip>');
        console.log(JSON.stringify(importGrokSkills(args[1], home), null, 2));
        return;
    }
    if (args[0] === 'skills') {
        console.log(JSON.stringify(listPersonalSkills(home, process.cwd()), null, 2));
        return;
    }
    const value = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
    const targetFlag = args.includes('--execution-target')
        ? PersonalExecutionTargetSchema.parse(value('--execution-target')) : undefined;
    if (targetFlag && args.includes('--resume')) throw new Error('Cannot change an existing Personal session execution target. Resume its saved target, or create a separate new conversation.');
    const previousTarget = process.env.PAWS_PERSONAL_EXECUTION_TARGET;
    if (targetFlag) process.env.PAWS_PERSONAL_EXECUTION_TARGET = targetFlag;
    try {
        if (args.includes('--print')) {
            const text = value('--print');
            if (!text) throw new Error('--print requires a prompt');
            const config = loadPersonalConfig();
            const computer = config.executionTarget === 'docker'
                ? new (await import('./computer')).PersonalComputer({ home, onFrame: () => {} }) : undefined;
            try {
                // Status attaches to an already-started computer; inference is
                // never allowed to create a Docker resource implicitly.
                if (computer) await computer.request({ action: 'status' });
                const engine = new PersonalEngine({ home, cwd: process.cwd(), sessionId: `local-${randomUUID()}`,
                    config, computer, approve: async () => false });
                await engine.turn(text, personalPermissionMode(value('--permission-mode')), new AbortController().signal,
                    event => { if (event.type === 'text') console.log(event.text); });
            } finally { await computer?.dispose(); }
            return;
        }
        const { credentials } = await authAndSetupMachineIfNeeded();
        await runPersonal({ credentials, resume: value('--resume'), startedBy: value('--started-by') === 'daemon' ? 'daemon' : 'terminal' });
        // Only the executable exits here. SDK/live checks can await runPersonal
        // without terminating their host; the CLI must release imported handles.
        process.exit(0);
    } finally {
        if (targetFlag) {
            if (previousTarget === undefined) delete process.env.PAWS_PERSONAL_EXECUTION_TARGET;
            else process.env.PAWS_PERSONAL_EXECUTION_TARGET = previousTarget;
        }
    }
}
