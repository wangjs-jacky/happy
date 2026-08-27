import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PawsAgentClient } from './client/PawsAgentClient';
import type { Session } from './client/types';
import { runCli, type CliDependencies } from './cli';

const session: Session = {
    id: 'session-1', seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
    metadata: {}, metadataVersion: 1, agentState: {}, agentStateVersion: 1,
};

afterEach(() => {
    process.exitCode = undefined;
});

describe('thin CLI', () => {
    it('delegates send to the public SDK and keeps JSON on stdout', async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const send = vi.fn().mockResolvedValue({ sessionId: 'session-1', localId: 'local-1' });
        const client = {
            sessions: { list: vi.fn().mockResolvedValue([session]) },
            messages: { send },
            dispose: vi.fn(),
        } as unknown as PawsAgentClient;
        const dependencies: CliDependencies = {
            client,
            auth: { login: vi.fn(), logout: vi.fn(), status: vi.fn() },
            stdout: value => stdout.push(value),
            stderr: value => stderr.push(value),
        };

        await runCli(['node', 'paws-agent', 'send', 'session-1', 'hello', '--json'], dependencies);

        expect(send).toHaveBeenCalledWith({
            sessionId: 'session-1',
            text: 'hello',
            meta: undefined,
        });
        expect(JSON.parse(stdout.join(''))).toEqual({ sessionId: 'session-1', localId: 'local-1' });
        expect(stderr).toEqual([]);
    });
});
