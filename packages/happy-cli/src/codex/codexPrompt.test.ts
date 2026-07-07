import { describe, expect, it } from 'vitest';

import { CHANGE_TITLE_INSTRUCTION } from '@/gemini/constants';
import {
    HAPPY_CODEX_IMAGE_WORKFLOW_INSTRUCTION,
    buildCodexTurnPrompt,
    hashCodexEnhancedMode,
    type CodexEnhancedMode,
} from './codexPrompt';

describe('buildCodexTurnPrompt', () => {
    it('prepends Happy append system prompt before the first Codex user message', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'pick an option',
            mode: {
                appendSystemPrompt: '<options><option>Yes</option></options>',
            },
            includeAppendSystemPrompt: true,
            includeTitleInstruction: true,
        });

        expect(prompt).toBe(
            '<options><option>Yes</option></options>\n\n' +
            HAPPY_CODEX_IMAGE_WORKFLOW_INSTRUCTION + '\n\n' +
            'pick an option\n\n' +
            CHANGE_TITLE_INSTRUCTION,
        );
    });

    it('preserves the existing first-turn title instruction when no append prompt is set', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'hello',
            mode: {},
            includeAppendSystemPrompt: true,
            includeTitleInstruction: true,
        });

        expect(prompt).toBe(`${HAPPY_CODEX_IMAGE_WORKFLOW_INSTRUCTION}\n\nhello\n\n${CHANGE_TITLE_INSTRUCTION}`);
    });

    it('adds Happy built-in image workflow guidance on the first Codex turn', () => {
        const prompt = buildCodexTurnPrompt({
            message: '画三张产品图',
            mode: {},
            includeAppendSystemPrompt: false,
            includeTitleInstruction: true,
        });

        expect(prompt).toContain('Happy built-in image workflow');
        expect(prompt).toContain('host-native image tools');
        expect(prompt).toContain('run them in parallel when the host runtime allows it');
        expect(prompt).toContain('mcp__happy__send_image');
        expect(prompt).toContain('画三张产品图');
    });

    it('does not inject Happy preamble on normal follow-up turns', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'continue',
            mode: {
                appendSystemPrompt: '<options><option>Yes</option></options>',
            },
            includeAppendSystemPrompt: false,
            includeTitleInstruction: false,
        });

        expect(prompt).toBe('continue');
    });

    it('can re-inject Happy append prompt without title instruction after a thread reset', () => {
        const prompt = buildCodexTurnPrompt({
            message: 'start fresh',
            mode: {
                appendSystemPrompt: '<options><option>Yes</option></options>',
            },
            includeAppendSystemPrompt: true,
            includeTitleInstruction: false,
        });

        expect(prompt).toBe(
            '<options><option>Yes</option></options>\n\n' +
            'start fresh',
        );
    });

    it('tells Codex when Happy has already applied model and effort settings', () => {
        const prompt = buildCodexTurnPrompt({
            message: '切换 xhigh 模式',
            mode: {
                model: 'gpt-5.4',
                effort: 'xhigh',
            },
            includeAppendSystemPrompt: false,
            includeTitleInstruction: false,
        });

        expect(prompt).toBe(
            'Happy has already applied these Codex runtime settings for this turn: model=gpt-5.4, reasoning_effort=xhigh. ' +
            'If the user asks to switch to one of these settings, acknowledge that it is already active; do not look for a tool or API to change it.\n\n' +
            '切换 xhigh 模式',
        );
    });
});

describe('hashCodexEnhancedMode', () => {
    it('separates queued Codex messages with different append system prompts', () => {
        const baseMode: CodexEnhancedMode = {
            permissionMode: 'default',
            model: 'gpt-5.5',
            effort: 'medium',
        };

        expect(hashCodexEnhancedMode({
            ...baseMode,
            appendSystemPrompt: 'options A',
        })).not.toBe(hashCodexEnhancedMode({
            ...baseMode,
            appendSystemPrompt: 'options B',
        }));
    });
});
