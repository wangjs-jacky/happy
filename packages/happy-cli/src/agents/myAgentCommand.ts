import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMyAgentCommand, type MyAgentCommand } from '@slopus/happy-wire';
import { projectPath } from '@/projectPath';
import type { ApiSessionClient } from '@/api/apiSession';

type CommandMessage = {
    content: { text: string };
    meta?: { myAgentCommand?: MyAgentCommand };
};

/** Load the packaged Skill, never a similarly named file in the user's project. */
export function loadBuiltInAgentBuilderSkill(): string {
    const skill = readFileSync(join(projectPath(), 'skills', 'agent-builder', 'SKILL.md'), 'utf8');
    if (!skill.trim()) throw new Error('The bundled agent-builder Skill is empty');
    return skill;
}

export function getMyAgentCommand(message: CommandMessage): MyAgentCommand | null {
    // The app captures the explicit command before wrapping continuation history.
    return message.meta?.myAgentCommand ?? parseMyAgentCommand(message.content.text);
}

/** Publish support only from runners that have registered the command and Happy tools. */
export function declareMyAgentCommandCapability(session: Pick<ApiSessionClient, 'updateMetadata'>): void {
    session.updateMetadata(metadata => ({
        ...metadata,
        capabilities: { ...metadata.capabilities, myAgentCommand: true },
    }));
}

type PreparedCommand = { prompt: string } | { error: string };

/** Expand only explicit /agent turns, retaining all original conversation context. */
export function prepareMyAgentMessage(message: CommandMessage, options: {
    unsupportedEngine?: string;
    loadSkill?: () => string;
} = {}): PreparedCommand | null {
    const command = getMyAgentCommand(message);
    if (!command) return null;
    if (options.unsupportedEngine) {
        return { error: `${options.unsupportedEngine} does not expose Happy's Agent tools, so this /agent request was not executed. Use a Claude, Codex, Gemini, or OpenCode session to create or modify a saved Agent.` };
    }

    let skill: string;
    try {
        skill = (options.loadSkill ?? loadBuiltInAgentBuilderSkill)();
        if (!skill.trim()) throw new Error('Empty Skill');
    } catch {
        return { error: `Happy could not load its built-in agent-builder Skill. This /agent request was not executed. Restore or reinstall the CLI's bundled Skill and retry.` };
    }

    return { prompt: [
        'The user explicitly invoked /agent for this turn. Happy has loaded its built-in agent-builder Skill below. Follow it in this existing conversation; do not create or switch chat sessions and do not call agent_builder again to load the same Skill. Existing permissions, tool restrictions, and attachments still apply.',
        '--- Built-in agent-builder Skill ---',
        skill,
        '--- End built-in Skill ---',
        `Explicit /agent request: ${JSON.stringify(command.request)}`,
        command.request
            ? 'Carry out this request using the real Happy Agent tools. Only report creation or modification after agent_save succeeds.'
            : 'The user entered /agent without a request. Ask what Agent they want to create or modify, or what method they want to save from this conversation. Do not save an Agent yet.',
        '--- Original user message and continuation context ---',
        message.content.text,
    ].join('\n\n') };
}
