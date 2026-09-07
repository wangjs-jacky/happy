import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { getMonoFont, Typography } from './Typography';

describe('monospace typography', () => {
    it('uses the registered no-ligature Maple family for every supported style', () => {
        // Catches typography requesting an old or unregistered font family.
        expect(getMonoFont()).toBe('MapleMonoNL-Regular');
        expect(getMonoFont('italic')).toBe('MapleMonoNL-Italic');
        expect(Typography.mono('semiBold')).toEqual({ fontFamily: 'MapleMonoNL-SemiBold' });
    });
});
