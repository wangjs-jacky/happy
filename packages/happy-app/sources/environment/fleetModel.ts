import { DesiredComponentStateSchema } from '@slopus/happy-wire';
import type { ComponentApplyResult, ComponentObservation, ComponentPlan, EnvironmentReasonCode } from '@slopus/happy-wire';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';

export type FleetMachineScan = {
    machineId: string;
    online: boolean;
    observation?: ComponentObservation;
    plan?: ComponentPlan;
};

export type FleetTarget =
    | { kind: 'unavailable' }
    | { kind: 'ready'; targetVersion: string }
    | { kind: 'blocked'; reasonCode: 'version-source-mismatch' };

export type FleetRow = FleetMachineScan & {
    machine: Machine;
    status: 'pending' | 'offline' | 'ready' | 'install' | 'upgrade' | 'manual-repair'
        | 'rpc-error' | 'rpc-timeout' | 'succeeded' | 'failed' | 'stale-plan';
    reasonCode?: EnvironmentReasonCode;
    requiresScan?: boolean;
    result?: ComponentApplyResult;
};

export function resolveFleetTarget(scans: readonly FleetMachineScan[]): FleetTarget {
    const online = scans.filter((scan) => scan.online);
    if (online.some((scan) => scan.observation?.reasonCode === 'version-source-mismatch'
        || scan.plan?.reasonCode === 'version-source-mismatch')) {
        return { kind: 'blocked', reasonCode: 'version-source-mismatch' };
    }
    const versions = new Set<string>();
    for (const { observation } of online) {
        if (!observation || observation.support !== 'supported' || !observation.packageManager.available) continue;
        const desired = DesiredComponentStateSchema.safeParse({
            componentId: 'github-cli', targetVersion: observation.packageManager.stableVersion,
        });
        if (desired.success) versions.add(desired.data.targetVersion);
    }
    if (versions.size > 1) return { kind: 'blocked', reasonCode: 'version-source-mismatch' };
    const targetVersion = [...versions][0];
    return targetVersion ? { kind: 'ready', targetVersion } : { kind: 'unavailable' };
}

// A lost RPC acknowledgement cannot tell us whether the daemon finished its work.
export function fleetRpcError(error: unknown): Pick<FleetRow, 'status' | 'reasonCode' | 'requiresScan'> {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || /timed?\s*out|timeout/iu.test(error.message));
    return timeout
        ? { status: 'rpc-timeout', reasonCode: 'rpc-timeout', requiresScan: true }
        : { status: 'rpc-error', reasonCode: 'unexpected-error', requiresScan: true };
}

/** Results are aligned with the full registry, including fulfilled offline placeholders. */
export function buildFleetRows(
    machines: readonly Machine[],
    settledResults: readonly PromiseSettledResult<FleetMachineScan>[],
): FleetRow[] {
    return machines.map((machine, index) => {
        const base = { machine, machineId: machine.id, online: isMachineOnline(machine) };
        if (!base.online) return { ...base, status: 'offline', reasonCode: 'machine-offline' };
        const settled = settledResults[index];
        if (!settled || settled.status === 'rejected') {
            return { ...base, ...fleetRpcError(settled?.reason) };
        }
        const scan = settled.value;
        if (scan.machineId !== machine.id || !scan.online || !scan.observation) {
            return { ...base, ...fleetRpcError(undefined) };
        }
        const { observation, plan } = scan;
        const reasonCode = plan?.reasonCode ?? observation.reasonCode;
        const status = plan && plan.action !== 'none' ? plan.action
            : reasonCode || observation.support === 'unsupported' ? 'manual-repair' : 'ready';
        return { ...base, observation, plan, status, reasonCode };
    });
}
