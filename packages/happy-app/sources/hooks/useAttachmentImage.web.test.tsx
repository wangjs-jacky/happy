import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer does not publish declarations here.
import TestRenderer from 'react-test-renderer';
import { releaseImageViewerImageCache, useAttachmentImage } from './useAttachmentImage.web';
import { clearLocalHistoryCaches } from '@/sync/localHistoryStore';

const mocks = vi.hoisted(() => ({
    createAttachmentImageSource: vi.fn(),
    dispose: vi.fn(),
    downloadEncryptedAttachment: vi.fn(),
    token: 'test',
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        getCredentials: () => ({ token: mocks.token }),
        encryption: { getSessionBlobKey: () => new Uint8Array(32) },
    },
}));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://api.test' }));
vi.mock('@/sync/apiAttachments', () => ({
    downloadEncryptedAttachment: mocks.downloadEncryptedAttachment,
}));
vi.mock('@/encryption/blob', () => ({ decryptBlob: (bytes: Uint8Array) => bytes }));
vi.mock('@/utils/attachmentImageSource', () => ({
    createAttachmentImageSource: mocks.createAttachmentImageSource,
}));

function Probe(props: { onUri: (uri: string | null) => void }) {
    const state = useAttachmentImage('session', 'attachment', { lifetime: 'viewer' });
    React.useEffect(() => {
        props.onUri(state.uri);
    }, [props, state.uri]);
    return null;
}

describe('web image viewer attachment cache', () => {
    beforeEach(() => {
        releaseImageViewerImageCache();
        vi.clearAllMocks();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        mocks.downloadEncryptedAttachment.mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
        mocks.createAttachmentImageSource.mockResolvedValue({
            uri: 'blob:full-resolution',
            byteSize: 4,
            dispose: mocks.dispose,
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('releases viewer-only full-resolution blobs after the modal is dismissed', async () => {
        const uris: Array<string | null> = [];
        let renderer: { unmount: () => void } | undefined;

        await act(async () => {
            renderer = TestRenderer.create(<Probe onUri={(uri) => uris.push(uri)} />);
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(uris).toContain('blob:full-resolution');
        releaseImageViewerImageCache();
        expect(mocks.dispose).toHaveBeenCalledOnce();

        act(() => renderer?.unmount());
    });

    it('never reuses a decoded image after switching accounts', async () => {
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<Probe onUri={() => {}} />); });
        const uris: Array<string | null> = [];
        mocks.token = 'different-account';
        mocks.createAttachmentImageSource.mockResolvedValue({ uri: 'blob:other-account', dispose: vi.fn() });
        await act(async () => { renderer.update(<Probe onUri={uri => uris.push(uri)} />); });
        expect(uris).not.toContain('blob:full-resolution');
        expect(uris).toContain('blob:other-account');
        act(() => renderer.unmount()); releaseImageViewerImageCache();
    });

    it('disposes and rejects a decoded result completing after cache reset', async () => {
        let finish!: (value: any) => void;
        mocks.createAttachmentImageSource.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const uris: Array<string | null> = [];
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<Probe onUri={uri => uris.push(uri)} />); });
        act(() => renderer.unmount());
        await clearLocalHistoryCaches();
        const dispose = vi.fn();
        await act(async () => { finish({ uri: 'blob:stale', dispose }); });
        expect(dispose).toHaveBeenCalledOnce();
        expect(uris).not.toContain('blob:stale');
        releaseImageViewerImageCache();
    });
});
