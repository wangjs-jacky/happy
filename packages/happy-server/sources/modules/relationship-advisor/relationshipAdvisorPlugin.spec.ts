import { describe, expect, it, vi } from 'vitest';

import {
    createRelationshipAdvisorPlugin,
    createRelationshipAdvisorPluginRuntime,
} from './relationshipAdvisorPlugin';

describe('createRelationshipAdvisorPlugin', () => {
    it('stores the complete provider configuration while exposing only redacted status', async () => {
        const secrets = new Map<string, string>();
        const vault = {
            set: vi.fn(async (accountId: string, pluginId: string, value: string) => {
                secrets.set(`${accountId}:${pluginId}`, value);
            }),
            get: vi.fn(async (accountId: string, pluginId: string) => (
                secrets.get(`${accountId}:${pluginId}`) ?? null
            )),
            delete: vi.fn(async () => undefined),
        };
        const plugin = createRelationshipAdvisorPlugin(vault);

        await plugin.install('user-1', {
            apiKey: 'sk-secret-1234',
            baseUrl: 'https://api.example.com/v1/',
            model: 'example-chat',
        });

        await expect(plugin.getStatus('user-1')).resolves.toEqual({
            installed: true,
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
            keyHint: '1234',
        });
        expect(JSON.parse(secrets.get('user-1:relationship-advisor')!)).toEqual({
            apiKey: 'sk-secret-1234',
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
        });
    });

    it('requires installation before returning provider credentials', async () => {
        const plugin = createRelationshipAdvisorPlugin({
            set: vi.fn(async () => undefined),
            get: vi.fn(async () => null),
            delete: vi.fn(async () => undefined),
        });

        await expect(plugin.getStatus('user-2')).resolves.toEqual({ installed: false });
        await expect(plugin.requireConfiguration('user-2'))
            .rejects.toThrow('Relationship advisor plugin is not installed');
    });

    it('never exposes a short API key as its status hint', async () => {
        const plugin = createRelationshipAdvisorPlugin({
            set: vi.fn(async () => undefined),
            get: vi.fn(async () => JSON.stringify({
                apiKey: 'abc',
                baseUrl: 'https://api.example.com/v1',
                model: 'example-chat',
            })),
            delete: vi.fn(async () => undefined),
        });

        await expect(plugin.getStatus('user-short-key')).resolves.toMatchObject({
            installed: true,
            keyHint: '••••',
        });
    });

    it('deletes the encrypted configuration when the plugin is uninstalled', async () => {
        const remove = vi.fn(async () => undefined);
        const plugin = createRelationshipAdvisorPlugin({
            set: vi.fn(async () => undefined),
            get: vi.fn(async () => null),
            delete: remove,
        });

        await plugin.uninstall('user-3');

        expect(remove).toHaveBeenCalledWith('user-3', 'relationship-advisor');
    });
});

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
