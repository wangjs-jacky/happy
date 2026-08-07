import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as DocumentPicker from 'expo-document-picker';
import { MAX_IMAGES_PER_MESSAGE, useImagePicker } from './useImagePicker';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

vi.mock('expo-image-picker', () => ({}));
// Same reason as normalizeImageForUpload below: importing the real
// expo-document-picker drags in expo-modules-core (__DEV__ undefined in node).
vi.mock('expo-document-picker', () => ({
    getDocumentAsync: vi.fn(),
}));
vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
    Keyboard: { dismiss: () => {}, isVisible: () => false, addListener: vi.fn() },
}));
vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn() },
}));
vi.mock('@/utils/thumbhash', () => ({
    generateThumbhash: vi.fn(),
}));
// Stub the normalizer so importing the hook doesn't pull in expo-image-manipulator
// (→ expo-modules-core, which references __DEV__ and blows up in the node test env).
vi.mock('@/utils/normalizeImageForUpload', () => ({
    normalizeImageForUpload: vi.fn(),
}));
// AttachmentSourceSheet drags in @expo/vector-icons + unistyles (expo-modules-core
// → __DEV__ undefined in node). Not exercised by these constant-focused tests.
vi.mock('@/components/AttachmentSourceSheet', () => ({
    AttachmentSourceSheet: () => null,
}));
vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

describe('useImagePicker limits', () => {
    it('allows up to 50 images per message', () => {
        expect(MAX_IMAGES_PER_MESSAGE).toBe(50);
    });
});

describe('useImagePicker PDF documents', () => {
    let current: ReturnType<typeof useImagePicker> | null = null;

    function Probe() {
        current = useImagePicker();
        return null;
    }

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        current = null;
        vi.mocked(DocumentPicker.getDocumentAsync).mockReset();
    });

    it('opens a PDF-only document picker and adds a generic file attachment', async () => {
        vi.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
            canceled: false,
            assets: [{
                uri: 'file:///tmp/floor-plan.pdf',
                name: 'floor-plan.pdf',
                size: 2048,
                mimeType: 'application/pdf',
                lastModified: 0,
            }],
        });

        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(React.createElement(Probe));
        });

        const pickPdf = (current as any)?.pickPdf;
        expect(typeof pickPdf).toBe('function');
        if (typeof pickPdf !== 'function') return;

        await act(async () => {
            await pickPdf();
        });

        expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
            type: 'application/pdf',
            multiple: true,
            copyToCacheDirectory: true,
        });
        expect(current?.selectedImages).toEqual([
            expect.objectContaining({
                uri: 'file:///tmp/floor-plan.pdf',
                name: 'floor-plan.pdf',
                size: 2048,
                mimeType: 'application/pdf',
                kind: 'file',
            }),
        ]);
        act(() => renderer.unmount());
    });
});
