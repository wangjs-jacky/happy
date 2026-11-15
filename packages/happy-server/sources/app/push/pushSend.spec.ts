import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendPushNotifications } from './pushSend';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

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

    it('does not expose a push token from an Expo error ticket', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            data: [{
                status: 'error',
                message: 'ExponentPushToken[private-device-token] is not registered',
                details: { error: 'DeviceNotRegistered', expoPushToken: 'ExponentPushToken[private-device-token]' },
            }],
        }), { status: 200 })));

        const tickets = await sendPushNotifications([{ to: 'ExponentPushToken[current]' }]);

        expect(tickets).toEqual([{
            status: 'error',
            message: 'Expo ticket error',
            details: { error: 'DeviceNotRegistered' },
        }]);
        expect(JSON.stringify(tickets)).not.toContain('private-device-token');
    });

    it('sends a later token while an earlier request is still pending and preserves ticket order', async () => {
        let releaseFirst!: (response: Response) => void;
        const firstResponse = new Promise<Response>(resolve => { releaseFirst = resolve; });
        const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
            const [{ to }] = JSON.parse(String(init.body));
            return to === 'ExponentPushToken[old]'
                ? firstResponse
                : Promise.resolve(new Response(JSON.stringify({ data: [{ status: 'ok', id: 'current-ticket' }] }), { status: 200 }));
        });
        vi.stubGlobal('fetch', fetchImpl);

        const result = sendPushNotifications([
            { to: 'ExponentPushToken[old]' },
            { to: 'ExponentPushToken[current]' },
        ]);
        await Promise.resolve();

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        releaseFirst(new Response(JSON.stringify({ data: [{ status: 'ok', id: 'old-ticket' }] }), { status: 200 }));
        expect(await result).toEqual([
            { status: 'ok', id: 'old-ticket' },
            { status: 'ok', id: 'current-ticket' },
        ]);
    });

    it('bounds a request that never resolves', async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
        vi.stubGlobal('fetch', fetchImpl);

        const result = sendPushNotifications([{ to: 'ExponentPushToken[stalled]' }]);
        await vi.runAllTimersAsync();

        expect(await result).toEqual([{ status: 'error', message: 'Network error' }]);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('bounds an Expo response whose body never finishes', async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn(async () => ({
            ok: true,
            json: () => new Promise<unknown>(() => {}),
        } as Response));
        vi.stubGlobal('fetch', fetchImpl);

        const result = sendPushNotifications([{ to: 'ExponentPushToken[stalled-body]' }]);
        await vi.runAllTimersAsync();

        expect(await result).toEqual([{ status: 'error', message: 'Network error' }]);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('does not retry HTTP 400 when its response body stalls', async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn(async () => ({
            ok: false,
            status: 400,
            json: () => new Promise<unknown>(() => {}),
        } as Response));
        vi.stubGlobal('fetch', fetchImpl);

        const result = sendPushNotifications([{ to: 'ExponentPushToken[invalid]' }]);
        await vi.runAllTimersAsync();

        expect(await result).toEqual([{ status: 'error', message: 'HTTP 400' }]);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
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
