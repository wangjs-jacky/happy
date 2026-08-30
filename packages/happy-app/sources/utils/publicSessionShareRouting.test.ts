import { describe, expect, it } from 'vitest';
import { isPublicSessionSharePath } from './publicSessionShareRouting';

describe('isPublicSessionSharePath', () => {
    it('isolates only public share routes from the authenticated workspace', () => {
        expect(isPublicSessionSharePath('/share/abc')).toBe(true);
        expect(isPublicSessionSharePath('/share/abc/')).toBe(true);
        expect(isPublicSessionSharePath('/share')).toBe(false);
        expect(isPublicSessionSharePath('/session/abc')).toBe(false);
        expect(isPublicSessionSharePath('/')).toBe(false);
    });
});
