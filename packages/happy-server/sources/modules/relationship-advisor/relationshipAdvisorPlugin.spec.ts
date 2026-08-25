import { describe, expect, it, vi } from 'vitest';

import {
    createRelationshipAdvisorPluginRuntime,
} from './relationshipAdvisorPlugin';

describe('createRelationshipAdvisorPluginRuntime', () => {
    it('decrypts the user configuration only when starting the provider stream', async () => {
        const configuration = {
            apiKey: 'server-stored-secret',
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
        };
        const requireConfiguration = vi.fn(async () => configuration);
        const providerStream = vi.fn(async function* () {
            yield { text: 'hello' };
        });
        const runtime = createRelationshipAdvisorPluginRuntime(
            { requireConfiguration },
            providerStream,
        );
        const input = {
            userId: 'user-4',
            messages: [{ role: 'user' as const, text: 'hi' }],
            imageUrls: [],
        };

        const deltas = [];
        for await (const delta of runtime.stream(input)) deltas.push(delta);

        expect(deltas).toEqual([{ text: 'hello' }]);
        expect(requireConfiguration).toHaveBeenCalledWith('user-4');
        expect(providerStream).toHaveBeenCalledWith(input, configuration);
    });
});
