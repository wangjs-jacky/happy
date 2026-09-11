import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { resolveCodexHome } from './codexHome';

// Mirrors the server's reviewed codexAccountTypes.ts credential contract.
export const CODEX_AUTH_MAX_BYTES = 64 * 1024;
const token = z.string().min(1).max(24_000).refine(s => s.trim().length > 0);
export const codexAccountAuthSchema = z.object({
  auth_mode: z.literal('chatgpt').optional(), OPENAI_API_KEY: z.null().optional(),
  tokens: z.object({ id_token: token, access_token: token, refresh_token: token,
    account_id: z.string().min(1).max(256).refine(s => s.trim() === s),
  }).strict(),
  last_refresh: z.string().datetime({ offset: true }).nullable().optional(),
}).strict().refine(v => Buffer.byteLength(JSON.stringify(v)) <= CODEX_AUTH_MAX_BYTES);
export type CodexAccountAuth = z.infer<typeof codexAccountAuthSchema>;

export async function readCodexAccountAuth(home = resolveCodexHome()): Promise<CodexAccountAuth> {
  try {
    // O_NOFOLLOW rejects auth symlinks; O_NONBLOCK avoids hanging on a FIFO.
    const file = await open(join(home, 'auth.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > CODEX_AUTH_MAX_BYTES) throw new Error();
      const buffer = Buffer.alloc(CODEX_AUTH_MAX_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > CODEX_AUTH_MAX_BYTES) throw new Error();
      return codexAccountAuthSchema.parse(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
    } finally { await file.close(); }
  } catch { throw new Error('Invalid Codex auth.json. Run codex login and retry.'); }
}
