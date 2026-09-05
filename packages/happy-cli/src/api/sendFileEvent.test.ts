import { describe, it, expect } from 'vitest';
import { createEnvelope, sessionEnvelopeSchema } from '@slopus/happy-wire';

describe('sendFileEvent envelope contract', () => {
    it('builds a schema-valid file envelope with role user and no image block', () => {
        const envelope = createEnvelope('user', { t: 'file', ref: 'r1', name: 'pic.png', size: 123 });
        expect(sessionEnvelopeSchema.safeParse(envelope).success).toBe(true);
        expect(envelope.role).toBe('user');
        expect(envelope.ev).toMatchObject({ t: 'file', ref: 'r1', name: 'pic.png', size: 123 });
        expect((envelope.ev as any).image).toBeUndefined();
    });

    it('accepts generated image gallery metadata', () => {
        const envelope = createEnvelope('user', {
            t: 'file',
            ref: 'r1',
            name: 'pic.png',
            size: 123,
            source: 'generated',
            prompt: 'draw a cat',
            batchId: 'batch-1',
            localPath: '/tmp/pic.png',
        });
        expect(sessionEnvelopeSchema.safeParse(envelope).success).toBe(true);
        expect(envelope.ev).toMatchObject({
            t: 'file',
            ref: 'r1',
            name: 'pic.png',
            source: 'generated',
            prompt: 'draw a cat',
            batchId: 'batch-1',
        });
    });

    it('accepts generated plaintext MP4 metadata', () => {
        const envelope = createEnvelope('user', {
            t: 'file',
            ref: 'sessions/s1/attachments/clip.mp4',
            name: 'clip.mp4',
            size: 42,
            source: 'generated',
            kind: 'video',
            mimeType: 'video/mp4',
            encrypted: false,
            localPath: '/tmp/clip.mp4',
        });
        expect(sessionEnvelopeSchema.safeParse(envelope).success).toBe(true);
        expect(envelope.ev).toMatchObject({ kind: 'video', mimeType: 'video/mp4', encrypted: false });
    });

    it('accepts generated Honor motion-photo metadata', () => {
        const envelope = createEnvelope('user', {
            t: 'file',
            ref: 'sessions/s1/attachments/motion.enc',
            name: 'motion.jpg',
            size: 4096,
            source: 'generated',
            motionPhoto: { videoOffset: 2048, videoLength: 1024, mimeType: 'video/mp4' },
        });
        expect(sessionEnvelopeSchema.safeParse(envelope).success).toBe(true);
    });

    it('preserves stable Ego run metadata through the shared wire envelope', () => {
        const first = createEnvelope('user', {
            t: 'file', ref: 'browser-1', name: 'step-1.png', size: 123, source: 'browser_step',
            browserStep: { label: 'First round', runId: 'ego-task-42', skillName: 'ego-browser' },
        });
        const second = createEnvelope('user', {
            t: 'file', ref: 'browser-2', name: 'step-2.png', size: 234, source: 'browser_step',
            browserStep: { label: 'Second round', runId: 'ego-task-42', skillName: 'ego-browser' },
        });

        expect(sessionEnvelopeSchema.parse(first).ev).toMatchObject({
            browserStep: { runId: 'ego-task-42', skillName: 'ego-browser' },
        });
        expect(sessionEnvelopeSchema.parse(second).ev).toMatchObject({
            browserStep: { runId: 'ego-task-42', skillName: 'ego-browser' },
        });
    });

    it('rejects a file event with image block missing thumbhash (why we omit image)', () => {
        const bad = { id: 'x', time: 1, role: 'user', ev: { t: 'file', ref: 'r', name: 'n', size: 1, image: { width: 10, height: 10 } } };
        expect(sessionEnvelopeSchema.safeParse(bad).success).toBe(false);
    });
});
