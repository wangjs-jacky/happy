import { describe, expect, it } from 'vitest';
import otaRuntimeVersions from '../../../ota-runtime-versions.json';
import { systemPrompt } from './systemPrompt';

describe('systemPrompt image handling', () => {
    it('tells agents to recover host-native generated images from disk before reporting failure', () => {
        expect(systemPrompt).toContain('mcp__happy__send_image');
        expect(systemPrompt).toContain('mcp__happy__send_file');
        expect(systemPrompt).toContain('~/.codex/generated_images/<task-id>/');
        expect(systemPrompt).toContain('Do not claim that an image cannot be returned');
        expect(systemPrompt).toContain('copy the generated file there and leave the original in place');
    });

    it('keeps OTA preview metadata aligned with the preview runtime source of truth', () => {
        expect(systemPrompt).toContain(`runtimeVersion: ${otaRuntimeVersions.preview}`);
    });

    it('routes interactive previews for remote Paws clients to temporary HTTPS hosting instead of localhost', () => {
        expect(systemPrompt).toContain('# Remote interactive previews');
        expect(systemPrompt).toContain('must not give the user a localhost URL');
        expect(systemPrompt).toContain('Vercel or Cloudflare');
        expect(systemPrompt).toContain('temporary public HTTPS URL');
        expect(systemPrompt).toContain('Do not deploy the Paws production app');
        expect(systemPrompt).toContain('verify that the public URL is reachable');
        expect(systemPrompt).toContain('If publishing needs new credentials, incurs cost, or no authorized provider is available, ask the user');
        expect(systemPrompt).toContain('If a static image is sufficient, prefer the Images workflow above');
    });
});
