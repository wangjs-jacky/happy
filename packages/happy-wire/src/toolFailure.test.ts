import { describe, expect, it } from 'vitest';
import { summarizeToolFailureOutput, toolFailureDetail } from './toolFailure';

describe('command failure summaries', () => {
    it('ignores a documented error example and selects the real terminal diagnostic', () => {
        expect(summarizeToolFailureOutput([
            '---', 'name: dev', '---',
            '```sh', 'sed: /example/SKILL.md: Permission denied', '```',
            'cat: /actual/SKILL.md: No such file or directory',
        ].join('\n'))).toBe('cat: /actual/SKILL.md: No such file or directory');
    });

    it('does not report fenced error examples as a command failure', () => {
        expect(summarizeToolFailureOutput('---\nname: dev\n---\n```\nError: example\n```')).toBeNull();
    });

    it('removes ANSI color controls and supports CRLF diagnostics', () => {
        expect(summarizeToolFailureOutput('---\r\nname: dev\r\n\x1b[31mcat: /skills/dev/SKILL.md: Permission denied\x1b[0m'))
            .toBe('cat: /skills/dev/SKILL.md: Permission denied');
    });

    it('keeps plain error messages and bounds the summary', () => {
        expect(summarizeToolFailureOutput('\nCannot read SKILL.md\nPermission denied')).toBe('Cannot read SKILL.md');
        expect(summarizeToolFailureOutput('Error: ' + 'x'.repeat(500))?.length).toBe(280);
    });

    it.each(['', '  ', '---\nname: dev', '# Skill instructions\nError handling guide'])('does not use document metadata as an error: %s', (output) => {
        expect(summarizeToolFailureOutput(output)).toBeNull();
    });
});

describe('bounded command failure details', () => {
    it.each([3980, 8000])('retains a complete diagnostic at offset %s', (offset) => {
        const diagnostic = 'sed: /skills/workflow/SKILL.md: No such file or directory';
        const output = 'x'.repeat(offset) + '\n' + diagnostic + '\n' + 'y'.repeat(5000);
        const detail = toolFailureDetail(output, diagnostic);
        expect(detail).toContain(diagnostic);
        expect(detail.length).toBeLessThanOrEqual(4000);
    });

    it('keeps short output unchanged', () => {
        expect(toolFailureDetail('Error: failed', 'Error: failed')).toBe('Error: failed');
    });
});
