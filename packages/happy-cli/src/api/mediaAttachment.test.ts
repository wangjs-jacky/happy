import { describe, expect, it } from 'vitest';
import {
    isPlaintextMediaEvent,
    resolveMediaKind,
    stagedMediaPath,
    formatMediaAttachmentNotice,
    type MediaFileEvent,
} from './mediaAttachment';
import { buildCodexInput } from '@/codex/codexImageInput';
import type { MediaAttachment, PendingAttachment } from '@/utils/MessageQueue2';

const ev = (over: Partial<MediaFileEvent>): MediaFileEvent => ({
    ref: 'r',
    name: 'file.bin',
    size: 100,
    ...over,
});

describe('isPlaintextMediaEvent', () => {
    it('only opts in on explicit encrypted:false (back-compat with legacy images)', () => {
        expect(isPlaintextMediaEvent(ev({ encrypted: false }))).toBe(true);
        expect(isPlaintextMediaEvent(ev({ encrypted: true }))).toBe(false);
        expect(isPlaintextMediaEvent(ev({}))).toBe(false); // missing → encrypted image path
    });
});

describe('resolveMediaKind', () => {
    it('trusts wire kind first', () => {
        expect(resolveMediaKind(ev({ kind: 'audio', mimeType: 'video/mp4' }))).toBe('audio');
    });
    it('falls back to mimeType prefix', () => {
        expect(resolveMediaKind(ev({ mimeType: 'audio/mpeg', name: 'x' }))).toBe('audio');
        expect(resolveMediaKind(ev({ mimeType: 'video/mp4', name: 'x' }))).toBe('video');
    });
    it('falls back to extension, else defaults to video', () => {
        expect(resolveMediaKind(ev({ name: 'voice.mp3' }))).toBe('audio');
        expect(resolveMediaKind(ev({ name: 'clip.mkv' }))).toBe('video');
        expect(resolveMediaKind(ev({ name: 'noext' }))).toBe('video');
    });
});

describe('stagedMediaPath', () => {
    it('keeps extension, sanitises name, is collision-resistant via stamp+index', () => {
        const p = stagedMediaPath(ev({ name: 'my clip!.mp4' }), '2026-07-13T00:00:00.000Z', 2);
        expect(p).toMatch(/2026-07-13T00-00-00-000Z-2-my_clip_\.mp4$/);
    });
    it('handles names without extension', () => {
        const p = stagedMediaPath(ev({ name: 'recording' }), '2026-01-01T00:00:00Z', 0);
        expect(p).toMatch(/2026-01-01T00-00-00Z-0-recording$/);
    });
});

describe('formatMediaAttachmentNotice', () => {
    const media = (over: Partial<MediaAttachment>): MediaAttachment => ({
        kind: 'video',
        localPath: '/tmp/x.mp4',
        size: 210 * 1024 * 1024,
        mimeType: 'video/mp4',
        name: 'x.mp4',
        ...over,
    });

    it('returns null with no media', () => {
        expect(formatMediaAttachmentNotice([])).toBeNull();
    });
    it('lists each path with human size and a tool hint', () => {
        const notice = formatMediaAttachmentNotice([
            media({}),
            media({ kind: 'audio', localPath: '/tmp/v.mp3', mimeType: 'audio/mpeg', size: 3 * 1024 * 1024 }),
        ]);
        expect(notice).toContain('/tmp/x.mp4');
        expect(notice).toContain('210.0MB');
        expect(notice).toContain('/tmp/v.mp3');
        expect(notice).toContain('3.0MB');
        expect(notice).toMatch(/ffmpeg|whisper/);
    });
});

describe('buildCodexInput with media attachments', () => {
    it('injects media path notice into text, no localImage for media', () => {
        const attachments: PendingAttachment[] = [
            { kind: 'video', localPath: '/tmp/clip.mp4', size: 1234, mimeType: 'video/mp4', name: 'clip.mp4' },
        ];
        const input = buildCodexInput('transcribe this', attachments);
        // No localImage items produced for media
        expect(input.filter((i) => i.type === 'localImage')).toHaveLength(0);
        const text = input.find((i) => i.type === 'text') as { type: 'text'; text: string };
        expect(text.text).toContain('/tmp/clip.mp4');
        expect(text.text).toContain('transcribe this');
    });
});
