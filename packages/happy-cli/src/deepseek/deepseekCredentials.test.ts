import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractDeepSeekKeyFromOpenCodeAuth, resolveDeepSeekApiKey } from './deepseekCredentials';

const originalDeepSeekApiKey = process.env.DEEPSEEK_API_KEY;
const originalHappyDeepSeekApiKey = process.env.HAPPY_DEEPSEEK_API_KEY;
const originalOpenCodeAuthFile = process.env.OPENCODE_AUTH_FILE;
const originalHappyDeepSeekOpenCodeAuthFile = process.env.HAPPY_DEEPSEEK_OPENCODE_AUTH_FILE;

afterEach(() => {
  if (originalDeepSeekApiKey === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
  } else {
    process.env.DEEPSEEK_API_KEY = originalDeepSeekApiKey;
  }
  if (originalHappyDeepSeekApiKey === undefined) {
    delete process.env.HAPPY_DEEPSEEK_API_KEY;
  } else {
    process.env.HAPPY_DEEPSEEK_API_KEY = originalHappyDeepSeekApiKey;
  }
  if (originalOpenCodeAuthFile === undefined) {
    delete process.env.OPENCODE_AUTH_FILE;
  } else {
    process.env.OPENCODE_AUTH_FILE = originalOpenCodeAuthFile;
  }
  if (originalHappyDeepSeekOpenCodeAuthFile === undefined) {
    delete process.env.HAPPY_DEEPSEEK_OPENCODE_AUTH_FILE;
  } else {
    process.env.HAPPY_DEEPSEEK_OPENCODE_AUTH_FILE = originalHappyDeepSeekOpenCodeAuthFile;
  }
});

describe('extractDeepSeekKeyFromOpenCodeAuth', () => {
  it('extracts the DeepSeek key from OpenCode auth JSON', () => {
    expect(extractDeepSeekKeyFromOpenCodeAuth(JSON.stringify({
      deepseek: {
        type: 'api',
        key: '  sk-test  ',
      },
    }))).toBe('sk-test');
  });

  it('returns null when the DeepSeek key is missing', () => {
    expect(extractDeepSeekKeyFromOpenCodeAuth(JSON.stringify({
      deepseek: {
        type: 'api',
      },
    }))).toBeNull();
  });
});

describe('resolveDeepSeekApiKey', () => {
  it('prefers Happy-specific environment key', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-env';
    process.env.HAPPY_DEEPSEEK_API_KEY = 'sk-happy-env';

    expect(resolveDeepSeekApiKey()).toEqual({
      key: 'sk-happy-env',
      source: 'env',
    });
  });

  it('falls back to OpenCode auth JSON', () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.HAPPY_DEEPSEEK_API_KEY;
    delete process.env.HAPPY_DEEPSEEK_OPENCODE_AUTH_FILE;

    const dir = mkdtempSync(join(tmpdir(), 'happy-deepseek-auth-'));
    try {
      const authPath = join(dir, 'auth.json');
      process.env.OPENCODE_AUTH_FILE = authPath;
      writeFileSync(authPath, JSON.stringify({
        deepseek: {
          type: 'api',
          key: 'sk-opencode',
        },
      }));

      expect(resolveDeepSeekApiKey()).toEqual({
        key: 'sk-opencode',
        source: 'opencode',
        path: authPath,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
