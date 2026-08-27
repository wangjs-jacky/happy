import axios, { type AxiosInstance } from 'axios';
import { normalizeHttpError, PawsAgentError } from '../client/errors';
import type { CredentialProvider, PawsCredentials } from '../client/types';

const COMPATIBILITY_CLIENT = 'paws-agent-sdk/0.1.0';

export class PawsHttpTransport {
    private readonly serverUrl: string;
    private readonly credentials: CredentialProvider;
    private readonly client: AxiosInstance;

    constructor(options: {
        serverUrl: string;
        credentials: CredentialProvider;
        client?: AxiosInstance;
    }) {
        const serverUrl = options.serverUrl.trim().replace(/\/+$/, '');
        if (!serverUrl) {
            throw new PawsAgentError('INVALID_ARGUMENT', 'serverUrl is required');
        }
        this.serverUrl = serverUrl;
        this.credentials = options.credentials;
        this.client = options.client ?? axios;
    }

    async getCredentials(): Promise<PawsCredentials> {
        const credentials = await this.credentials.getCredentials();
        if (!credentials) {
            throw new PawsAgentError('AUTH_REQUIRED', 'Authentication required');
        }
        return credentials;
    }

    async get<T>(path: string): Promise<T> {
        try {
            const response = await this.client.get(this.url(path), {
                headers: await this.headers(),
            });
            return response.data as T;
        } catch (error) {
            throw normalizeHttpError(error, `GET ${path}`);
        }
    }

    async post<T>(path: string, body: unknown): Promise<T> {
        try {
            const response = await this.client.post(this.url(path), body, {
                headers: await this.headers(),
            });
            return response.data as T;
        } catch (error) {
            throw normalizeHttpError(error, `POST ${path}`);
        }
    }

    async delete(path: string): Promise<void> {
        try {
            await this.client.delete(this.url(path), {
                headers: await this.headers(),
            });
        } catch (error) {
            throw normalizeHttpError(error, `DELETE ${path}`);
        }
    }

    private url(path: string): string {
        if (!path.startsWith('/')) {
            throw new PawsAgentError('INVALID_ARGUMENT', 'HTTP path must start with /');
        }
        return this.serverUrl + path;
    }

    private async headers(): Promise<Record<string, string>> {
        const credentials = await this.getCredentials();
        return {
            Authorization: `Bearer ${credentials.token}`,
            'X-Happy-Client': COMPATIBILITY_CLIENT,
        };
    }
}
