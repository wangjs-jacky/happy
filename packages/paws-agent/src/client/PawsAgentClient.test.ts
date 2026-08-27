import { describe, expect, it, vi } from 'vitest';
import { PawsAgentClient } from './PawsAgentClient';

describe('PawsAgentClient', () => {
    it('composes resources and delegates lifecycle without import-time connection', async () => {
        const realtime = { connect: vi.fn(), disconnect: vi.fn(), dispose: vi.fn() };
        const credentials = {
            getCredentials: vi.fn(), setCredentials: vi.fn(), clearCredentials: vi.fn(),
        };
        const client = new PawsAgentClient(
            { serverUrl: 'https://paws.example', credentials },
            { realtime: realtime as never },
        );

        expect(realtime.connect).not.toHaveBeenCalled();
        expect(client.machines).toBeDefined();
        expect(client.sessions).toBeDefined();
        expect(client.messages).toBeDefined();
        expect(client.requests).toBeDefined();

        await client.connect();
        await client.disconnect();
        await client.dispose();
        expect(realtime.connect).toHaveBeenCalledOnce();
        expect(realtime.disconnect).toHaveBeenCalledOnce();
        expect(realtime.dispose).toHaveBeenCalledOnce();
    });
});
