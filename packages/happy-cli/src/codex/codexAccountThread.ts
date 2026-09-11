import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configuration } from '@/configuration';
import { CodexAppServerClient } from './codexAppServerClient';
import { copyCodexSourceThread, retainCodexAccountHistory } from './codexAccountHistory';

export async function withCodexAccountThread<T>(
  source: { sourceSessionId: string; codexThreadId: string },
  operation: (client: CodexAppServerClient) => Promise<T>,
  options: { historyRoot?: string; createClient?: (env: NodeJS.ProcessEnv) => CodexAppServerClient } = {},
): Promise<T> {
  if (!source.sourceSessionId) throw new Error('Codex source history unavailable: sourceSessionId is required');
  const home = await mkdtemp(join(tmpdir(), 'happy-codex-history-'));
  const root = options.historyRoot ?? join(configuration.happyHomeDir, 'codex-session-cache');
  try {
    const profile = await copyCodexSourceThread(root, source.sourceSessionId, source.codexThreadId, home);
    // Deliberately no auth/config inheritance. Only local native history RPCs
    // use this client, and fork callers defer goal continuation until real spawn.
    const env: NodeJS.ProcessEnv = { CODEX_HOME: home, HAPPY_CODEX_APP_SERVER_MODE: 'spawn', HAPPY_CODEX_ACCOUNT_PROFILE_ID: profile };
    for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'TEMP', 'SystemRoot', 'LANG', 'HAPPY_CODEX_PATH']) if (process.env[key]) env[key] = process.env[key];
    const client = (options.createClient ?? (env => new CodexAppServerClient(undefined, { type: 'spawn' }, env)))(env);
    let result: T;
    try {
      await client.connect();
      result = await operation(client);
    } finally { await client.disconnect(); }
    await retainCodexAccountHistory(root, profile, home);
    return result;
  } finally { await rm(home, { recursive: true, force: true }); }
}
