import { describe, expect, it } from 'vitest';
import {
    getEffectiveFileViewerDisplayMode,
    getInitialFileViewerDisplayMode,
} from './fileViewerState';

describe('fileViewerState', () => {
    it('opens directly in file mode when there is no cached diff', () => {
        expect(getInitialFileViewerDisplayMode(false, null)).toBe('file');
    });

    it('keeps cached diff as the initial mode when available', () => {
        expect(getInitialFileViewerDisplayMode(true, null)).toBe('diff');
    });

    it('prefers file mode for explicit line links', () => {
        expect(getInitialFileViewerDisplayMode(true, 12)).toBe('file');
    });

    it('falls back to file mode when content has loaded before diff', () => {
        expect(getEffectiveFileViewerDisplayMode('diff', false, true)).toBe('file');
    });

    it('keeps diff mode when diff content exists', () => {
        expect(getEffectiveFileViewerDisplayMode('diff', true, true)).toBe('diff');
    });
});
