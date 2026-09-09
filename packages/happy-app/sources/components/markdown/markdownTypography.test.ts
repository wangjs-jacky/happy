import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { getMarkdownTypography } from './markdownTypography';

describe('getMarkdownTypography', () => {
    it('keeps prose and inline code on the same Maple Mono family', () => {
        const typography = getMarkdownTypography('chatMono');

        expect(typography.body?.fontFamily).toBe('MapleMonoNL-Regular');
        expect(typography.inlineCode?.fontFamily).toBe(typography.body?.fontFamily);
    });

    it('uses the bundled Maple Mono faces for emphasized content', () => {
        const typography = getMarkdownTypography('chatMono');

        expect(typography.italic?.fontFamily).toBe('MapleMonoNL-Italic');
        expect(typography.italic?.fontStyle).toBe('normal');
        expect(typography.strong?.fontFamily).toBe('MapleMonoNL-SemiBold');
        expect(typography.strong?.fontWeight).toBe('normal');
    });

    it('leaves non-chat Markdown typography unchanged', () => {
        expect(getMarkdownTypography('default')).toEqual({});
    });
});
