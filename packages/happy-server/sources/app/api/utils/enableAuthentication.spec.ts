import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
    verifyToken: vi.fn(),
}));

vi.mock('@/utils/log', () => ({ log: mocks.log }));
vi.mock('@/app/auth/auth', () => ({ auth: { verifyToken: mocks.verifyToken } }));

import { enableAuthentication } from './enableAuthentication';

describe('enableAuthentication', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verifyToken.mockResolvedValue({ userId: 'account-1' });
    });

    it('never writes bearer credentials into authentication logs', async () => {
        let authenticate: ((request: any, reply: any) => Promise<void>) | undefined;
        enableAuthentication({
            decorate(name: string, handler: typeof authenticate) {
                expect(name).toBe('authenticate');
                authenticate = handler;
            },
        } as any);
        const secret = 'bearer-secret-that-must-never-appear-in-logs';
        const request = {
            headers: { authorization: `Bearer ${secret}` },
            url: '/v1/auth/account/response',
        };

        await authenticate?.(request, {});

        expect(request).toHaveProperty('userId', 'account-1');
        const logged = JSON.stringify(mocks.log.mock.calls);
        expect(logged).not.toContain(secret);
        expect(logged).not.toContain(`Bearer ${secret}`);
        expect(mocks.log).toHaveBeenCalledWith(
            expect.objectContaining({ hasAuthorization: true, module: 'auth-decorator', path: request.url }),
            'Auth check',
        );
    });
});
