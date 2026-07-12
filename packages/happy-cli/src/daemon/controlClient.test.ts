import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockReadDaemonState: vi.fn(),
  mockClearDaemonState: vi.fn(),
}));

vi.mock('@/persistence', () => ({
  readDaemonState: mocks.mockReadDaemonState,
  clearDaemonState: mocks.mockClearDaemonState,
}));

import { spawnDaemonSession } from './controlClient';

describe('spawnDaemonSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockReadDaemonState.mockResolvedValue({
      pid: 12345,
      httpPort: 54321,
    });
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, sessionId: 'happy-session-123' }),
    }));
  });

  it('passes resume ids to the daemon control server', async () => {
    await spawnDaemonSession({
      directory: '/repo',
      agent: 'codex',
      resumeCodexThreadId: 'codex-thread-123',
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:54321/spawn-session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          directory: '/repo',
          agent: 'codex',
          resumeCodexThreadId: 'codex-thread-123',
        }),
      }),
    );
  });
});
