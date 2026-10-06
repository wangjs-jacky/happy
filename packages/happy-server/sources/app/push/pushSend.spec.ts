import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendPushNotifications } from './pushSend';

afterEach(() => vi.unstubAllGlobals());

describe('sendPushNotifications', () => {
    it('isolates tokens so a mixed-project batch cannot reject the current device', async () => {
        const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
            const messages = JSON.parse(String(init.body));
            if (messages.length > 1) {
                return new Response(JSON.stringify({
                    errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'Tokens belong to different projects' }]
                }), { status: 400 });
            }
            return new Response(JSON.stringify({ data: [{ status: 'ok', id: `ticket-${messages[0].to}` }] }), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchImpl);

        const tickets = await sendPushNotifications([
            { to: 'ExponentPushToken[older]', title: 'Ready' },
            { to: 'ExponentPushToken[current]', title: 'Ready' },
        ]);

        expect(tickets).toEqual([
            { status: 'ok', id: 'ticket-ExponentPushToken[older]' },
            { status: 'ok', id: 'ticket-ExponentPushToken[current]' },
        ]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('keeps Expo error codes while never returning a token from the response body', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            errors: [{
                code: 'PUSH_TOO_MANY_EXPERIENCE_IDS',
                message: 'ExponentPushToken[private-device-token] belongs to another project',
            }],
        }), { status: 400 })));

        const tickets = await sendPushNotifications([{ to: 'ExponentPushToken[current]', title: 'Ready' }]);

        expect(tickets).toEqual([{
            status: 'error',
            message: 'HTTP 400',
            details: { error: 'PUSH_TOO_MANY_EXPERIENCE_IDS' },
        }]);
        expect(JSON.stringify(tickets)).not.toContain('private-device-token');
    });

    it('retries a transient network failure before giving up on a device', async () => {
        const fetchImpl = vi.fn()
            .mockRejectedValueOnce(new Error('proxy connection reset'))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ status: 'ok', id: 'accepted-ticket' }] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchImpl);

        const tickets = await sendPushNotifications([{ to: 'ExponentPushToken[current]', title: 'Ready' }]);

        expect(tickets).toEqual([{ status: 'ok', id: 'accepted-ticket' }]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it.each([429, 503])('retries Expo HTTP %i before giving up on a device', async (status) => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ code: 'TEMPORARY_ERROR' }] }), { status }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ status: 'ok', id: 'accepted-ticket' }] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchImpl);

        const tickets = await sendPushNotifications([{ to: 'ExponentPushToken[current]', title: 'Ready' }]);

        expect(tickets).toEqual([{ status: 'ok', id: 'accepted-ticket' }]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
