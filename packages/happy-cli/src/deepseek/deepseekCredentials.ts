import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type DeepSeekApiKeySource = 'env' | 'opencode';

export type DeepSeekApiKeyResolution = {
  key: string | null;
  source: DeepSeekApiKeySource | null;
  path?: string;
};

function candidateOpenCodeAuthPaths(): string[] {
  const home = homedir();
  return [
    process.env.HAPPY_DEEPSEEK_OPENCODE_AUTH_FILE,
    process.env.OPENCODE_AUTH_FILE,
    process.env.OPENCODE_DATA_DIR ? join(process.env.OPENCODE_DATA_DIR, 'auth.json') : undefined,
    process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json') : undefined,
    join(home, '.local', 'share', 'opencode', 'auth.json'),
    join(home, '.config', 'opencode', 'auth.json'),
  ].filter((path): path is string => !!path);
}

export function extractDeepSeekKeyFromOpenCodeAuth(raw: string): string | null {
  const parsed = JSON.parse(raw) as {
    deepseek?: {
      key?: unknown;
    };
  };
  return typeof parsed.deepseek?.key === 'string' && parsed.deepseek.key.trim()
    ? parsed.deepseek.key.trim()
    : null;
}

export function resolveDeepSeekApiKey(): DeepSeekApiKeyResolution {
  const envKey = process.env.HAPPY_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (envKey?.trim()) {
    return { key: envKey.trim(), source: 'env' };
  }

  for (const path of candidateOpenCodeAuthPaths()) {
    if (!existsSync(path)) {
      continue;
    }
    try {
      const key = extractDeepSeekKeyFromOpenCodeAuth(readFileSync(path, 'utf8'));
      if (key) {
        return { key, source: 'opencode', path };
      }
    } catch {
      // Ignore malformed or inaccessible OpenCode auth files and keep looking.
    }
  }

  return { key: null, source: null };
}
