import { describe, expect, it } from 'vitest';
import { sessionEnvelopeSchema } from '@slopus/happy-wire';
import {
    buildCloudflarePreviewEnvelopes,
    PREVIEW_FIXTURE_IDS,
} from '../../e2e/fixtures/cloudflare-interactive-previews/fixture';

describe('Cloudflare preview visual fixture', () => {
    it('uses wire-valid deterministic states and two independently scrollable Ego runs', () => {
        const envelopes = buildCloudflarePreviewEnvelopes();
        expect(envelopes.every((envelope) => sessionEnvelopeSchema.safeParse(envelope).success)).toBe(true);

        const previewEvents = envelopes.filter((envelope) => envelope.ev.t === 'interactive-preview');
        expect(previewEvents.map((envelope) => (envelope.ev.preview as { id: string; state: string }))).toEqual([
            { version: 1, provider: 'cloudflare', mode: 'hosted', id: PREVIEW_FIXTURE_IDS.publishing, title: 'Publishing checkout flow', state: 'publishing' },
            expect.objectContaining({ id: PREVIEW_FIXTURE_IDS.ready, state: 'ready' }),
            expect.objectContaining({ id: PREVIEW_FIXTURE_IDS.failed, state: 'failed' }),
            expect.objectContaining({ id: PREVIEW_FIXTURE_IDS.expired, state: 'expired' }),
        ]);

        const browserEvents = envelopes.filter((envelope) => envelope.ev.t === 'file');
        expect(browserEvents).toHaveLength(15);
        expect(new Set(browserEvents.map((envelope) => (
            envelope.ev.browserStep as { runId: string }
        ).runId))).toEqual(new Set(['ego-fixture-run-1', 'ego-fixture-run-2']));
    });
});
