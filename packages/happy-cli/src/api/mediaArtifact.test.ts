import { describe, expect, it } from 'vitest';
import { resolveMediaArtifact } from './mediaArtifact';

describe('resolveMediaArtifact', () => {
    it('infers the phone-playable MP4 lane from an absolute path', () => {
        expect(resolveMediaArtifact('/tmp/acceptance.mp4')).toEqual({
            kind: 'video',
            mimeType: 'video/mp4',
        });
    });

    it('accepts an explicit matching media MIME type', () => {
        expect(resolveMediaArtifact('/tmp/capture.webm', 'video/webm')).toEqual({
            kind: 'video',
            mimeType: 'video/webm',
        });
    });

    it('rejects relative, unsupported, and mismatched inputs', () => {
        expect(() => resolveMediaArtifact('clip.mp4')).toThrow(/absolute/);
        expect(() => resolveMediaArtifact('/tmp/report.pdf')).toThrow(/Unsupported media file/);
        expect(() => resolveMediaArtifact('/tmp/clip.mp4', 'audio/mpeg')).toThrow(/does not match/);
    });
});
