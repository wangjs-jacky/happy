import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { readCredentials, type Credentials } from '@/persistence';
import { readCodexAccountAuth, type CodexAccountAuth } from '@/codex/codexAccountAuth';
import { ApiClient } from '@/api/api';
import { configuration } from '@/configuration';
import { codexAccountServerUrl } from '@/api/codexAccountTypes';

type UploadDependencies = {
  readCredentials: () => Promise<Credentials | null>;
  readAuth: () => Promise<CodexAccountAuth>;
  upload: (credentials: Credentials, auth: CodexAccountAuth) => Promise<{ profile: { displayName: string; status: string } }>;
  confirm: () => Promise<boolean>;
  isInteractive: () => boolean;
  output: (message: string) => void;
  serverUrl: string;
};

export async function uploadCurrentCodexAccount(overrides: Partial<UploadDependencies> = {}): Promise<void> {
  const deps: UploadDependencies = {
    readCredentials, readAuth: readCodexAccountAuth,
    upload: async (credentials, auth) => (await ApiClient.create(credentials)).uploadCodexAccount(auth),
    isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
    output: console.log, serverUrl: configuration.serverUrl,
    confirm: async () => {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try { return /^y(es)?$/i.test((await input.question('Upload this Codex account? [y/N] ')).trim()); }
      finally { input.close(); }
    }, ...overrides,
  };
  const credentials = await deps.readCredentials();
  if (!credentials) throw new Error('Sign in to Paws first: paws auth login');
  if (!deps.isInteractive()) throw new Error('Codex account upload requires an interactive terminal.');
  const accountOrigin = new URL(codexAccountServerUrl(deps.serverUrl)).origin;
  const auth = await deps.readAuth();
  // The server assigns the final HMAC-based name; no provider identity is printed.
  const pawsIdentity = createHash('sha256').update(credentials.encryption.type === 'legacy'
    ? credentials.encryption.secret : credentials.encryption.publicKey).digest('hex').slice(0, 8);
  deps.output(`Codex · •••• (automatic name on upload) → signed-in Paws account ${pawsIdentity} at ${accountOrigin}`);
  if (!await deps.confirm()) return;
  const { profile } = await deps.upload(credentials, auth);
  deps.output(`${profile.displayName}: ${profile.status}. Manage accounts in Paws → Device environment.`);
}
