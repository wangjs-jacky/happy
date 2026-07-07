import type { PermissionMode } from '@/api/types';
import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import { hashObject } from '@/utils/deterministicJson';

import type { ReasoningEffort } from './codexAppServerTypes';

export interface CodexEnhancedMode {
    permissionMode: PermissionMode;
    model?: string;
    /** Happy app instructions appended to the first Codex prompt for option chips. */
    appendSystemPrompt?: string;
    /** Reasoning effort passed through to Codex's sendTurnAndWait. */
    effort?: ReasoningEffort;
}

export const HAPPY_CODEX_IMAGE_WORKFLOW_INSTRUCTION = [
    'Happy built-in image workflow:',
    '- When the user asks to generate, edit, batch, or show images, treat it as a Happy-native capability, not as a required external Skill.',
    '- Prefer Codex / host-native image tools when available. Do not switch to local gateway, Garden/OpenAI-compatible scripts, or `scripts/generate.js` unless the user explicitly asks for that mode.',
    '- For multiple variants or selected styles, render each variant as an independent prompt and run them in parallel when the host runtime allows it. Fall back to serial only when the host tool or API clearly limits concurrency.',
    '- After native image generation, check the generated image output directory such as `~/.codex/generated_images/` when the tool result does not expose a path, then copy or save PNG/JPEG files under `garden-gpt-image-2/image/` when practical.',
    '- Whenever a local PNG/JPEG is ready, call `mcp__happy__send_image` with its absolute path so the image renders inline in Happy. Do not use Markdown image syntax for local files.',
].join('\n');

export function hashCodexEnhancedMode(mode: CodexEnhancedMode): string {
    return hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model,
        appendSystemPrompt: mode.appendSystemPrompt,
        effort: mode.effort,
    });
}

export function buildCodexTurnPrompt(opts: {
    message: string;
    mode: Pick<CodexEnhancedMode, 'appendSystemPrompt' | 'model' | 'effort'>;
    includeAppendSystemPrompt: boolean;
    includeTitleInstruction: boolean;
}): string {
    const parts: string[] = [];

    if (opts.includeAppendSystemPrompt && opts.mode.appendSystemPrompt) {
        parts.push(opts.mode.appendSystemPrompt);
    }

    const modeStatus: string[] = [];
    if (opts.mode.model) modeStatus.push(`model=${opts.mode.model}`);
    if (opts.mode.effort) modeStatus.push(`reasoning_effort=${opts.mode.effort}`);
    if (modeStatus.length > 0) {
        parts.push(
            `Happy has already applied these Codex runtime settings for this turn: ${modeStatus.join(', ')}. ` +
            `If the user asks to switch to one of these settings, acknowledge that it is already active; do not look for a tool or API to change it.`
        );
    }

    if (opts.includeTitleInstruction) {
        parts.push(HAPPY_CODEX_IMAGE_WORKFLOW_INSTRUCTION);
    }

    parts.push(opts.message);

    if (opts.includeTitleInstruction) {
        parts.push(CHANGE_TITLE_INSTRUCTION);
    }

    return parts.join('\n\n');
}
