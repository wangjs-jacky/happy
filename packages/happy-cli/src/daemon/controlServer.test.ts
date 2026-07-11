import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDaemonControlServer } from './controlServer';

describe('startDaemonControlServer', () => {
  let stopServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (stopServer) {
      await stopServer();
      stopServer = null;
    }
  });

  it('forwards resume ids from local spawn requests', async () => {
    const spawnSession = vi.fn().mockResolvedValue({
      type: 'success',
      sessionId: 'happy-session-123',
    });
    const { port, stop } = await startDaemonControlServer({
      getChildren: () => [],
      stopSession: () => false,
      spawnSession,
      requestShutdown: () => {},
      onHappySessionWebhook: () => {},
    });
    stopServer = stop;

    const response = await fetch(`http://127.0.0.1:${port}/spawn-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directory: '/repo',
        agent: 'claude',
        resumeClaudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
      }),
    });

    expect(response.ok).toBe(true);
    expect(spawnSession).toHaveBeenCalledWith({
      directory: '/repo',
      agent: 'claude',
      resumeClaudeSessionId: '93a9705e-bc6a-406d-8dce-8acc014dedbd',
      sessionId: undefined,
      environmentVariables: undefined,
    });
  });
});
