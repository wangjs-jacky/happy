import { describe, expect, it } from 'vitest';
import { deliveryPrompt } from './deliveryPrompt';
describe('per-message delivery preference', () => {
    it('explicitly resets historical away instructions when disabled', () => {
        expect(deliveryPrompt({ awayFromComputer: false, previewDeliveryMode: 'hosted' })).toContain('Current delivery mode: normal');
        expect(deliveryPrompt({})).toContain('supersedes earlier');
    });
    it('defaults to a tunnel only for enabled preferences without a mode', () => {
        expect(deliveryPrompt({ awayFromComputer: true })).toContain('with mode=tunnel');
    });
    it('requires hosted mode without claiming authorization or silently falling back', () => {
        const prompt = deliveryPrompt({ awayFromComputer: true, previewDeliveryMode: 'hosted' });
        expect(prompt).toContain('with mode=hosted');
        expect(prompt).toContain('Never silently fall back');
        expect(prompt).toContain('determined by the tools at execution time');
        expect(prompt).toContain('one-time mode override');
    });
});
