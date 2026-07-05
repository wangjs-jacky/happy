import { describe, expect, it } from 'vitest';
import { shouldExpandCodexPatchByDefault } from './codexPatchDisplay';

describe('Codex patch display defaults', () => {
    it('expands patches that include a unified diff', () => {
        expect(shouldExpandCodexPatchByDefault({
            diff: '@@ -1 +1 @@\n-old\n+new\n',
        })).toBe(true);
    });

    it('expands patches that include old and new content', () => {
        expect(shouldExpandCodexPatchByDefault({
            modify: {
                old_content: 'before',
                new_content: 'after',
            },
        })).toBe(true);
    });

    it('keeps patches without renderable diff content collapsed', () => {
        expect(shouldExpandCodexPatchByDefault({
            kind: { type: 'update' },
        })).toBe(false);
    });
});
