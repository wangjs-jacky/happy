import axios from 'axios';
import { encodeBase64 } from "../encryption/base64";
import { getServerUrl } from "@/sync/serverConfig";
import { getHappyClientId } from "@/sync/apiSocket";

export type AccountLinkApprovalErrorCode = 'request-not-found' | 'unauthorized' | 'network' | 'server-error';

export class AccountLinkApprovalError extends Error {
    readonly code: AccountLinkApprovalErrorCode;
    readonly server: string;
    readonly status: number | null;
    readonly publicKeyId: string;

    constructor(code: AccountLinkApprovalErrorCode, server: string, status: number | null, publicKeyId: string) {
        super(`Account link approval failed: ${code}`);
        this.name = 'AccountLinkApprovalError';
        this.code = code;
        this.server = server;
        this.status = status;
        this.publicKeyId = publicKeyId;
    }
}

function safeServerLabel(serverUrl: string): string {
    try {
        const url = new URL(serverUrl);
        return url.origin === 'null' ? 'configured server' : url.origin;
    } catch {
        return 'configured server';
    }
}

function responseErrorMessage(error: unknown): string | null {
    if (!axios.isAxiosError(error)) return null;
    const data = error.response?.data;
    if (!data || typeof data !== 'object') return null;
    const message = (data as { error?: unknown }).error;
    return typeof message === 'string' ? message : null;
}

export async function authAccountApprove(token: string, publicKey: Uint8Array, answer: Uint8Array) {
    const API_ENDPOINT = getServerUrl();
    const encodedPublicKey = encodeBase64(publicKey);
    try {
        await axios.post(`${API_ENDPOINT}/v1/auth/account/response`, {
            publicKey: encodedPublicKey,
            response: encodeBase64(answer)
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Happy-Client': getHappyClientId(),
            }
        });
    } catch (error) {
        if (!axios.isAxiosError(error)) {
            throw error;
        }
        const status = error.response?.status ?? null;
        const responseError = responseErrorMessage(error);
        const isAuthenticationFailure = status === 401
            && responseError !== null
            && /^(?:invalid token|missing authorization header|authentication failed)$/i.test(responseError);
        const code: AccountLinkApprovalErrorCode = status === 404
            ? 'request-not-found'
            : isAuthenticationFailure
                ? 'unauthorized'
                : status === null
                    ? 'network'
                    : 'server-error';
        throw new AccountLinkApprovalError(code, safeServerLabel(API_ENDPOINT), status, encodedPublicKey.slice(0, 16));
    }
}
