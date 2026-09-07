import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    post: vi.fn(),
    alert: vi.fn(),
    consoleError: vi.fn(),
    token: 'secret-bearer-token',
    serverUrl: 'https://server-a.example',
}));

vi.mock('axios', () => ({
    default: {
        post: mocks.post,
        isAxiosError: (error: unknown) => Boolean(
            error && typeof error === 'object' && (error as { isAxiosError?: boolean }).isAxiosError,
        ),
    },
}));
vi.mock('@/auth/AuthContext', () => ({
    useAuth: () => ({
        credentials: {
            token: mocks.token,
            secret: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
        },
    }),
}));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => mocks.serverUrl }));
vi.mock('@/sync/apiSocket', () => ({ getHappyClientId: () => 'happy-app/test' }));
vi.mock('@/encryption/libsodium', () => ({
    encryptBox: () => new Uint8Array([1, 2, 3]),
}));
vi.mock('@/modal', () => ({ Modal: { alert: mocks.alert } }));
vi.mock('@/text', () => ({
    t: (key: string, params?: unknown) => params ? `${key}:${JSON.stringify(params)}` : key,
}));

import { useConnectAccount } from './useConnectAccount';

const accountUrl = 'paws:///account?dh2I7IMEE5Gd_p1NHVbxfmU8jJlAgt9bE3uQoK5u33Q';

function renderHook() {
    let current: ReturnType<typeof useConnectAccount> | undefined;
    function Harness() {
        current = useConnectAccount();
        return null;
    }
    let renderer: { unmount: () => void } | undefined;
    act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
    return {
        current: () => {
            if (!current) throw new Error('Hook did not render');
            return current;
        },
        unmount: () => act(() => renderer?.unmount()),
    };
}

function axiosFailure(status?: number, error?: string) {
    return {
        isAxiosError: true,
        message: status ? `Request failed with status code ${status}` : 'Network Error',
        response: status ? { status, data: error ? { error } : undefined } : undefined,
    };
}

describe('useConnectAccount', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.serverUrl = 'https://server-a.example';
        mocks.post.mockResolvedValue({ data: { success: true } });
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(mocks.consoleError);
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        [404, 'Request not found', 'modals.accountLinkRequestNotFound'],
        [401, 'Invalid token', 'modals.accountLinkUnauthorized'],
    ])('shows an actionable diagnostic for HTTP %s without logging credentials', async (status, serverError, messageKey) => {
        mocks.post.mockRejectedValueOnce(axiosFailure(status, serverError));
        const hook = renderHook();

        await act(async () => {
            expect(await hook.current().processAuthUrl(accountUrl)).toBe(false);
        });

        expect(mocks.alert).toHaveBeenCalledWith(
            'common.error',
            `${messageKey}:${JSON.stringify({ server: mocks.serverUrl })}`,
            [{ text: 'common.ok' }],
        );
        const logged = JSON.stringify(mocks.consoleError.mock.calls);
        expect(logged).not.toContain(mocks.token);
        expect(logged).not.toContain('Authorization');
        hook.unmount();
    });

    it('distinguishes a network failure and identifies the attempted server', async () => {
        mocks.post.mockRejectedValueOnce(axiosFailure());
        const hook = renderHook();

        await act(async () => {
            expect(await hook.current().processAuthUrl(accountUrl)).toBe(false);
        });

        expect(mocks.alert).toHaveBeenCalledWith(
            'common.error',
            `modals.accountLinkNetworkError:${JSON.stringify({ server: mocks.serverUrl })}`,
            [{ text: 'common.ok' }],
        );
        hook.unmount();
    });

    it.each([
        [401, 'Invalid public key'],
        [403, 'Forbidden'],
        [503, 'Unavailable'],
    ])('does not misreport HTTP %s as an expired login', async (status, serverError) => {
        mocks.post.mockRejectedValueOnce(axiosFailure(status, serverError));
        const hook = renderHook();

        await act(async () => {
            expect(await hook.current().processAuthUrl(accountUrl)).toBe(false);
        });

        expect(mocks.alert).toHaveBeenCalledWith(
            'common.error',
            `modals.accountLinkServerError:${JSON.stringify({ server: mocks.serverUrl, status })}`,
            [{ text: 'common.ok' }],
        );
        hook.unmount();
    });

    it('does not misreport a non-HTTP client error as a network failure', async () => {
        mocks.post.mockRejectedValueOnce(new Error('unexpected adapter failure'));
        const hook = renderHook();

        await act(async () => {
            expect(await hook.current().processAuthUrl(accountUrl)).toBe(false);
        });

        expect(mocks.alert).toHaveBeenCalledWith(
            'common.error',
            'modals.failedToLinkDevice',
            [{ text: 'common.ok' }],
        );
        expect(mocks.consoleError).toHaveBeenCalledWith(
            'Account link failed before server approval',
            { code: 'client-error' },
        );
        hook.unmount();
    });

    it('redacts credentials and query secrets from the server label', async () => {
        mocks.serverUrl = 'https://user:password@server-a.example/api?token=query-secret';
        mocks.post.mockRejectedValueOnce(axiosFailure(404, 'Request not found'));
        const hook = renderHook();

        await act(async () => {
            expect(await hook.current().processAuthUrl(accountUrl)).toBe(false);
        });

        expect(mocks.alert).toHaveBeenCalledWith(
            'common.error',
            `modals.accountLinkRequestNotFound:${JSON.stringify({ server: 'https://server-a.example' })}`,
            [{ text: 'common.ok' }],
        );
        const logged = JSON.stringify(mocks.consoleError.mock.calls);
        expect(logged).not.toContain('password');
        expect(logged).not.toContain('query-secret');
        hook.unmount();
    });

    it('keeps the existing successful account-link behavior', async () => {
        const hook = renderHook();

        await act(async () => {
            expect(await hook.current().processAuthUrl(accountUrl)).toBe(true);
        });

        expect(mocks.post).toHaveBeenCalledWith(
            `${mocks.serverUrl}/v1/auth/account/response`,
            expect.objectContaining({ publicKey: expect.any(String), response: expect.any(String) }),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${mocks.token}` }) }),
        );
        expect(mocks.alert).toHaveBeenCalledWith('common.success', 'modals.deviceLinkedSuccessfully', expect.any(Array));
        hook.unmount();
    });
});
