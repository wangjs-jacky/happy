import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    readCredentials: vi.fn(),
    updateSettings: vi.fn(),
    loggerDebug: vi.fn(),
}));

vi.mock('@/persistence', () => ({
    readCredentials: mocks.readCredentials,
    updateSettings: mocks.updateSettings,
    writeCredentialsLegacy: vi.fn(),
    writeCredentialsDataKey: vi.fn(),
}));

vi.mock('./logger', () => ({
    logger: { debug: mocks.loggerDebug },
}));

import { WorkerSessionStartupLifecycle } from '@/api/sessionStartupTrace';
import { authAndSetupMachineIfNeeded } from './auth';

describe('authAndSetupMachineIfNeeded startup trace', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.readCredentials.mockResolvedValue({
            token: 'token-canary',
            encryption: { type: 'legacy', secret: new Uint8Array(32) },
        });
    });

    it('marks auth ready before delayed machine setup completes', async () => {
        const events: Record<string, unknown>[] = [];
        let finishMachineSetup!: () => void;
        mocks.updateSettings.mockReturnValue(new Promise((resolve) => {
            finishMachineSetup = () => resolve({ machineId: 'machine-1' });
        }));
        const ticks = [100, 110, 160, 220];
        const lifecycle = new WorkerSessionStartupLifecycle(
            '00000000-0000-4000-8000-000000000001',
            (_label, event) => events.push(event),
            () => ticks.shift()!,
            () => 1_000,
        );
        lifecycle.entryStarted();

        const authentication = authAndSetupMachineIfNeeded(lifecycle);
        await vi.waitFor(() => {
            expect(events.map((event) => event.stage)).toEqual([
                'worker.entry.started',
                'worker.auth.ready',
            ]);
        });
        expect(events.some((event) => event.stage === 'worker.machine.ready')).toBe(false);

        finishMachineSetup();
        await expect(authentication).resolves.toMatchObject({ machineId: 'machine-1' });
        expect(events.map((event) => [event.stage, event.duration])).toEqual([
            ['worker.entry.started', 10],
            ['worker.auth.ready', 60],
            ['worker.machine.ready', 120],
        ]);
        expect(JSON.stringify(events)).not.toContain('canary');
    });

    it('preserves auth and machine setup behavior when no trace exists', async () => {
        mocks.updateSettings.mockResolvedValue({ machineId: 'machine-1' });

        await expect(authAndSetupMachineIfNeeded()).resolves.toMatchObject({
            machineId: 'machine-1',
            credentials: expect.objectContaining({ token: 'token-canary' }),
        });
        expect(mocks.loggerDebug.mock.calls.some(([label]) => label === '[SESSION STARTUP]')).toBe(false);
    });
});
