import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());

vi.mock('./apiSocket', () => ({ apiSocket: { request } }));

import {
    getRelationshipAdvisorPluginStatus,
    installRelationshipAdvisorPlugin,
    uninstallRelationshipAdvisorPlugin,
} from './relationshipAdvisorPlugin';

describe('relationship advisor plugin client', () => {
    beforeEach(() => vi.clearAllMocks());

    it('loads the redacted installation status', async () => {
        request.mockResolvedValue(new Response(JSON.stringify({
            installed: true,
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
            keyHint: '1234',
        }), { status: 200, headers: { 'content-type': 'application/json' } }));

        await expect(getRelationshipAdvisorPluginStatus()).resolves.toEqual({
            installed: true,
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
            keyHint: '1234',
        });
        expect(request).toHaveBeenCalledWith('/v1/plugins/relationship-advisor');
    });

    it('installs and uninstalls through the authenticated Paws server', async () => {
        request
            .mockResolvedValueOnce(new Response(JSON.stringify({
                installed: true,
                baseUrl: 'https://api.example.com/v1',
                model: 'example-chat',
                keyHint: '1234',
            }), { status: 200, headers: { 'content-type': 'application/json' } }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ installed: false }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }));
        const configuration = {
            apiKey: 'sk-secret-1234',
            baseUrl: 'https://api.example.com/v1',
            model: 'example-chat',
        };

        await installRelationshipAdvisorPlugin(configuration);
        await uninstallRelationshipAdvisorPlugin();

        expect(request).toHaveBeenNthCalledWith(1, '/v1/plugins/relationship-advisor', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(configuration),
        });
        expect(request).toHaveBeenNthCalledWith(2, '/v1/plugins/relationship-advisor', {
            method: 'DELETE',
        });
    });
});
