/** Owner-process bridge to the SDK's durable native-session APIs.
 * The lifecycle callback retains daemon policy and account selection. Keys stay
 * in this process and are restricted to the machine and its known sessions.
 */
import { PawsAgentClient, type TrustedRecordKeyCredentials } from '@wangjs-jacky/paws-agent';
import type { Credentials } from '@/persistence';
import type { NativeSessionHooks } from './nativeSessionRuntime';

export type OwnerSessionEncryption = {
    encryptionKey: Uint8Array;
    encryptionVariant: 'legacy' | 'dataKey';
};

export function createOwnerNativeSessionHooks(input: {
    serverUrl: string;
    credentials: Credentials;
    machine: OwnerSessionEncryption & { id: string };
    resolveSessionEncryption: (sessionId: string) => OwnerSessionEncryption | null;
    start: NativeSessionHooks['start'];
}): NativeSessionHooks & { dispose(): Promise<void> } {
    // Even legacy credentials use the resolver scope: an owner-wide secret
    // must not turn this daemon bridge into access to another machine's sessions.
    const credentials: TrustedRecordKeyCredentials = {
        token: input.credentials.token,
        resolveRecordKey(record) {
            const encryption = record.type === 'machine'
                ? record.id === input.machine.id ? input.machine : null
                : input.resolveSessionEncryption(record.id);
            return encryption ? { key: encryption.encryptionKey, variant: encryption.encryptionVariant } : null;
        },
    };
    const client = new PawsAgentClient({
        serverUrl: input.serverUrl,
        credentials: { getCredentials: async () => credentials },
    });
    return {
        connect: () => client.connect(),
        get: sessionId => client.sessions.get(sessionId),
        historyPage: (sessionId, options) => client.messages.historyPage(sessionId, options),
        watch: (sessionId, options) => client.messages.watch(sessionId, options),
        send: message => client.messages.send(message),
        start: input.start,
        cancel: sessionId => client.sessions.cancel(sessionId),
        dispose: () => client.dispose(),
    };
}
