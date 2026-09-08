import { describe, expect, it } from 'vitest';
import type { Machine } from '@/sync/storageTypes';
import { buildFleetRows, resolveFleetTarget, type FleetMachineScan } from './fleetModel';

function machine(id: string, active = true): Machine {
    return { id, active, seq: 1, createdAt: 0, updatedAt: 0, activeAt: 0,
        metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0 };
}

function scanned(machineId: string, stableVersion: string): FleetMachineScan {
    return { machineId, online: true, observations: [{
        componentId: 'github-cli', platform: 'darwin', architecture: 'arm64',
        support: 'supported', installed: true, installedVersion: '2.80.0',
        resolvedExecutable: '/opt/homebrew/bin/gh',
        source: { kind: 'homebrew', available: true, latestVersion: stableVersion, ownership: 'verified' },
        capability: 'alignable', details: { kind: 'github-cli' },
        authentication: { provider: 'github.com', status: 'authenticated' }, inspectedAt: 1000,
    }] };
}

function offline(machineId: string): FleetMachineScan {
    return { machineId, online: false };
}

describe('fleet model', () => {
    it('excludes inspect-only Paws ownership mismatches from verified fleet target consensus', () => {
        const base = scanned('verified', '2.80.0').observations![0];
        const verified: FleetMachineScan = { machineId: 'verified', online: true, observations: [{
            ...base, componentId: 'paws-cli', capability: 'alignable', details: { kind: 'paws-cli' },
            source: { kind: 'npm-global', available: true, latestVersion: '1.6.0', ownership: 'verified' },
        }] };
        const unverified: FleetMachineScan = { machineId: 'unverified', online: true, observations: [{
            ...base, componentId: 'paws-cli', capability: 'inspect-only', details: { kind: 'paws-cli' },
            source: { kind: 'npm-global', available: true, latestVersion: '1.7.0', ownership: 'unverified' },
            reasonCode: 'version-source-mismatch',
        }] };
        expect(resolveFleetTarget([verified, unverified], 'paws-cli')).toEqual({ kind: 'ready', targetVersion: '1.6.0' });
        expect(resolveFleetTarget([unverified], 'paws-cli')).toEqual({ kind: 'unavailable' });
    });
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
        scan.observations![0].reasonCode = 'version-source-mismatch';
        expect(resolveFleetTarget([scan])).toEqual({ kind: 'blocked', reasonCode: 'version-source-mismatch' });
        expect(resolveFleetTarget([offline('mini')])).toEqual({ kind: 'unavailable' });
        scan.observations![0].reasonCode = undefined;
        scan.observations![0].source.latestVersion = 'not-a-version';
        expect(resolveFleetTarget([scan])).toEqual({ kind: 'unavailable' });
    });

    it('keeps success and repair rows when another machine fails, in registry order', () => {
        const machines = [machine('air'), machine('mini-1'), machine('mini-2'), machine('offline', false)];
        const repair = scanned('mini-1', '2.80.0');
        repair.observations![0].authentication!.status = 'missing';
        repair.observations![0].reasonCode = 'authentication-missing';
        const settledResults: PromiseSettledResult<FleetMachineScan>[] = [
            { status: 'fulfilled', value: scanned('air', '2.80.0') },
            { status: 'fulfilled', value: repair },
            { status: 'rejected', reason: new Error('Disconnected') },
            { status: 'fulfilled', value: offline('offline') },
        ];
        const rows = buildFleetRows(machines, settledResults);
        expect(rows.map((row) => row.machineId)).toEqual(['air', 'mini-1', 'mini-2', 'offline']);
        expect(rows.map((row) => row.components['github-cli'].status)).toEqual(['ready', 'manual-repair', 'rpc-error', 'offline']);
        expect(rows[1].components['github-cli'].observation?.authentication!.status).toBe('missing');
    });

    it.each(['operation has timed out', 'RPC call timed out', 'timeout'])('keeps %s as unknown with a scan required', (message) => {
        expect(buildFleetRows([machine('air')], [{ status: 'rejected', reason: new Error(message) }])[0].components['github-cli'])
            .toMatchObject({ status: 'rpc-timeout', reasonCode: 'rpc-timeout', requiresScan: true });
    });

    it('retains all rows when a result is absent or assigned to the wrong machine', () => {
        expect(buildFleetRows([machine('air'), machine('mini')], [
            { status: 'fulfilled', value: scanned('other', '2.80.0') },
        ]).map((row) => row.components['github-cli'].status)).toEqual(['rpc-error', 'rpc-error']);
    });

    it('uses daemon plans without deriving an install action locally', () => {
        const scan = scanned('air', '2.80.0');
        scan.observations![0].installed = false;
        scan.observations![0].installedVersion = null;
        scan.plans = [{ componentId: 'github-cli', action: 'install', fromVersion: null,
            targetVersion: '2.80.0', planFingerprint: 'a'.repeat(64), expiresAt: 601000 }];
        expect(buildFleetRows([machine('air')], [{ status: 'fulfilled', value: scan }])[0].components['github-cli'])
            .toMatchObject({ status: 'install', plan: scan.plans[0] });
    });
    it('maps all observations and plans by component identity, regardless of response order', () => {
        const github = scanned('air', '2.80.0').observations![0];
        const paws = { ...github, componentId: 'paws-cli' as const, capability: 'alignable' as const, details: { kind: 'paws-cli' as const },
            installedVersion: '1.5.0', source: { ...github.source, kind: 'npm-global' as const, latestVersion: '1.6.0' } };
        const scan: FleetMachineScan = { machineId: 'air', online: true, observations: [paws, github],
            plans: [{ componentId: 'paws-cli', action: 'upgrade', fromVersion: '1.5.0',
                targetVersion: '1.6.0', planFingerprint: 'b'.repeat(64), expiresAt: 601000 }] };
        const row = buildFleetRows([machine('air')], [{ status: 'fulfilled', value: scan }])[0];
        expect(Object.keys(row.components)).toEqual(['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared']);
        expect(row.components['github-cli']).toMatchObject({ componentId: 'github-cli', status: 'ready', observation: github });
        expect(row.components['github-cli'].plan).toBeUndefined();
        expect(row.components['paws-cli']).toMatchObject({ componentId: 'paws-cli', status: 'upgrade', observation: paws, plan: scan.plans![0] });
        expect(row.components['ego-browser']).toMatchObject({ componentId: 'ego-browser', status: 'rpc-error', requiresScan: true });
    });

    it('keeps five explicit offline entries and isolates a failed component', () => {
        const scan = scanned('air', '2.80.0');
        const github = scan.observations![0];
        scan.observations!.push({ ...github, componentId: 'paws-cli', capability: 'alignable', details: { kind: 'paws-cli' },
            reasonCode: 'process-timeout' });
        const rows = buildFleetRows([machine('air'), machine('offline', false)],
            [{ status: 'fulfilled', value: scan }]);
        expect(rows[0].components['github-cli'].status).toBe('ready');
        expect(rows[0].components['paws-cli'].reasonCode).toBe('process-timeout');
        expect(rows[0].components['paws-cli'].status).toBe('process-timeout');
        expect(rows[0].components['paws-cli'].requiresScan).not.toBe(true);
        expect(Object.values(rows[1].components)).toHaveLength(5);
        expect(Object.values(rows[1].components).every((entry) => entry.status === 'offline' && entry.reasonCode === 'machine-offline')).toBe(true);
    });

    it('resolves targets only from the requested component, excluding sibling versions and reasons', () => {
        const scan = scanned('air', '2.80.0');
        const github = scan.observations![0];
        scan.observations!.unshift({ ...github, componentId: 'paws-cli', capability: 'alignable', details: { kind: 'paws-cli' },
            source: { ...github.source, latestVersion: '1.6.0' }, reasonCode: 'version-source-mismatch' });
        expect(resolveFleetTarget([scan], 'github-cli')).toEqual({ kind: 'ready', targetVersion: '2.80.0' });
        expect(resolveFleetTarget([scan], 'paws-cli')).toEqual({ kind: 'blocked', reasonCode: 'version-source-mismatch' });
    });
});
