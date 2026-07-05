import { describe, expect, it } from 'vitest';

import { buildSessionTitlePrompt, sanitizeGeneratedTitle } from './sessionTitleWorker';

describe('session title worker helpers', () => {
    it('builds a prompt that emphasizes the current task transcript', () => {
        const prompt = buildSessionTitlePrompt({
            transcript: 'User: Please add a regenerate title button\nAssistant: I will inspect the code first.',
            currentTitle: 'hello',
            projectPath: '/repo/happy',
        });

        expect(prompt).toContain('Output only the title.');
        expect(prompt).toContain('Current title: hello');
        expect(prompt).toContain('Project path: /repo/happy');
        expect(prompt).toContain('Please add a regenerate title button');
        expect(prompt).toContain('Capture the actual current task');
    });

    it('sanitizes plain, markdown, and JSON title responses', () => {
        expect(sanitizeGeneratedTitle(' "Regenerate Session Title." ')).toBe('Regenerate Session Title');
        expect(sanitizeGeneratedTitle('```text\nBetter Title\n```')).toBe('Better Title');
        expect(sanitizeGeneratedTitle('{"title":"Happy App PR Preview!"}')).toBe('Happy App PR Preview');
    });

    it('caps long generated titles', () => {
        const title = sanitizeGeneratedTitle('x'.repeat(120));

        expect(title).toHaveLength(80);
    });
});
