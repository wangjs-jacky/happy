import { describe, it, expect } from 'vitest';
import { diffPendingScreenshots } from './screenshotSync';

describe('diffPendingScreenshots', () => {
    it('返回本地没有的引用（按 id 去重）', () => {
        const refs = [{ id: '1' }, { id: '2' }, { id: '3' }];
        const local = new Set(['2']);
        const pending = diffPendingScreenshots(refs, local);
        expect(pending.map((r) => r.id)).toEqual(['1', '3']);
    });

    it('本地全有时返回空', () => {
        const refs = [{ id: '1' }, { id: '2' }];
        const pending = diffPendingScreenshots(refs, new Set(['1', '2']));
        expect(pending).toEqual([]);
    });

    it('本地全无时原样返回', () => {
        const refs = [{ id: 'a' }, { id: 'b' }];
        const pending = diffPendingScreenshots(refs, new Set());
        expect(pending.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('保留 ref 的额外字段', () => {
        const refs = [{ id: '1', target: 'desktop', takenAt: 100 }];
        const pending = diffPendingScreenshots(refs, new Set());
        expect(pending[0]).toEqual({ id: '1', target: 'desktop', takenAt: 100 });
    });
});
