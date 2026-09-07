import { describe, expect, it } from 'vitest';
import type { Machine } from '@/sync/storageTypes';
import { buildFleetRows, resolveFleetTarget, type FleetMachineScan } from './fleetModel';

function machine(id: string, active = true): Machine {
    return { id, active, seq: 1, createdAt: 0, updatedAt: 0, activeAt: 0,
        metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0 };
}

function scanned(machineId: string, stableVersion: string): FleetMachineScan {
    return { machineId, online: true, observation: {
        componentId: 'github-cli', platform: 'darwin', architecture: 'arm64',
        support: 'supported', installed: true, installedVersion: '2.80.0',
        resolvedExecutable: '/opt/homebrew/bin/gh',
        packageManager: { kind: 'homebrew', available: true, stableVersion },
        authentication: { provider: 'github.com', status: 'authenticated' }, inspectedAt: 1000,
    } };
}

function offline(machineId: string): FleetMachineScan {
    return { machineId, online: false };
}

describe('fleet model', () => {
    it('resolves one common target while keeping offline machines visible', () => {
        expect(resolveFleetTarget([scanned('air', '2.80.0'), scanned('mini-1', '2.80.0'), offline('mini-2')]))
            .toEqual({ kind: 'ready', targetVersion: '2.80.0' });
    });

    it('blocks mutation when online machines disagree on the Homebrew target', () => {
        expect(resolveFleetTarget([scanned('air', '2.80.0'), scanned('mini', '2.81.0')]))
            .toEqual({ kind: 'blocked', reasonCode: 'version-source-mismatch' });
    });

    it('blocks even a single explicit source mismatch and refuses an empty target', () => {
        const scan = scanned('air', '2.80.0');
        scan.observation!.reasonCode = 'version-source-mismatch';
        expect(resolveFleetTarget([scan])).toEqual({ kind: 'blocked', reasonCode: 'version-source-mismatch' });
        expect(resolveFleetTarget([offline('mini')])).toEqual({ kind: 'unavailable' });
        scan.observation!.reasonCode = undefined;
        scan.observation!.packageManager.stableVersion = 'not-a-version';
        expect(resolveFleetTarget([scan])).toEqual({ kind: 'unavailable' });
    });

    it('keeps success and repair rows when another machine fails, in registry order', () => {
        const machines = [machine('air'), machine('mini-1'), machine('mini-2'), machine('offline', false)];
        const repair = scanned('mini-1', '2.80.0');
        repair.observation!.authentication.status = 'missing';
        repair.observation!.reasonCode = 'authentication-missing';
        const settledResults: PromiseSettledResult<FleetMachineScan>[] = [
            { status: 'fulfilled', value: scanned('air', '2.80.0') },
            { status: 'fulfilled', value: repair },
            { status: 'rejected', reason: new Error('Disconnected') },
            { status: 'fulfilled', value: offline('offline') },
        ];
        const rows = buildFleetRows(machines, settledResults);
        expect(rows.map((row) => row.machineId)).toEqual(['air', 'mini-1', 'mini-2', 'offline']);
        expect(rows.map((row) => row.status)).toEqual(['ready', 'manual-repair', 'rpc-error', 'offline']);
        expect(rows[1].observation?.authentication.status).toBe('missing');
    });

    it.each(['operation has timed out', 'RPC call timed out', 'timeout'])('keeps %s as unknown with a scan required', (message) => {
        expect(buildFleetRows([machine('air')], [{ status: 'rejected', reason: new Error(message) }])[0])
            .toMatchObject({ status: 'rpc-timeout', reasonCode: 'rpc-timeout', requiresScan: true });
    });

    it('retains all rows when a result is absent or assigned to the wrong machine', () => {
        expect(buildFleetRows([machine('air'), machine('mini')], [
            { status: 'fulfilled', value: scanned('other', '2.80.0') },
        ]).map((row) => row.status)).toEqual(['rpc-error', 'rpc-error']);
    });

    it('uses daemon plans without deriving an install action locally', () => {
        const scan = scanned('air', '2.80.0');
        scan.observation!.installed = false;
        scan.observation!.installedVersion = null;
        scan.plan = { componentId: 'github-cli', action: 'install', fromVersion: null,
            targetVersion: '2.80.0', planFingerprint: 'a'.repeat(64), expiresAt: 601000 };
        expect(buildFleetRows([machine('air')], [{ status: 'fulfilled', value: scan }])[0])
            .toMatchObject({ status: 'install', plan: scan.plan });
    });
});
