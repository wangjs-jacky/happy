import { describe, expect, it } from 'vitest';

import { systemPrompt } from './systemPrompt';

describe('systemPrompt', () => {
    it('does not add tool or AI attribution to commit messages', () => {
        expect(systemPrompt).not.toMatch(/\bcommit(?:s|ting)?\b/i);
    });

    it('keeps the remaining preview tools in the shared prompt', () => {
        expect(systemPrompt).toContain('mcp__happy__create_preview');
        expect(systemPrompt).toContain('mcp__happy__publish_preview');
        expect(systemPrompt).toContain('All previews use Cloudflare');
        expect(systemPrompt).toContain('do not launch a separate tunnel');
        expect(systemPrompt).not.toContain('mcp__happy__report_browser_step');
    });
});
