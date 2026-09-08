import { DesiredComponentStateSchema } from '@slopus/happy-wire';
import type { AlignableEnvironmentComponentId, ComponentApplyResult, ComponentObservation, ComponentPlan, EnvironmentComponentId, EnvironmentReasonCode } from '@slopus/happy-wire';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';

export const FLEET_COMPONENT_IDS = ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'] as const;

export type FleetMachineScan = {
    machineId: string;
    online: boolean;
    observations?: ComponentObservation[];
    plans?: ComponentPlan[];
};

export type FleetTarget =
    | { kind: 'unavailable' }
    | { kind: 'ready'; targetVersion: string }
    | { kind: 'blocked'; reasonCode: 'version-source-mismatch' };

export type FleetDispatchedAction = Readonly<Pick<ComponentPlan, 'action' | 'fromVersion' | 'targetVersion'>>;

export type FleetComponentRow = {
    componentId: EnvironmentComponentId;
    observation?: ComponentObservation;
    plan?: ComponentPlan;
    status: 'pending' | 'offline' | 'ready' | 'install' | 'upgrade' | 'authenticate' | 'onboard' | 'manual-repair'
        | 'rpc-error' | 'rpc-timeout' | 'process-timeout' | 'succeeded' | 'failed' | 'stale-plan';
    reasonCode?: EnvironmentReasonCode;
    requiresScan?: boolean;
    result?: ComponentApplyResult;
    dispatchedAction?: FleetDispatchedAction;
};

export type FleetRow = {
    machine: Machine;
    machineId: string;
    online: boolean;
    components: Record<EnvironmentComponentId, FleetComponentRow>;
};

export function fleetComponents(create: (componentId: EnvironmentComponentId) => FleetComponentRow): FleetRow['components'] {
    return Object.fromEntries(FLEET_COMPONENT_IDS.map((id) => [id, create(id)])) as FleetRow['components'];
}

export function resolveFleetTarget(
    scans: readonly (FleetMachineScan | FleetRow)[],
    componentId: AlignableEnvironmentComponentId = 'github-cli',
): FleetTarget {
    const online = scans.filter((scan) => scan.online).map((scan) => 'components' in scan
        ? scan.components[componentId]
        : { observation: scan.observations?.find((entry) => entry.componentId === componentId),
            plan: scan.plans?.find((entry) => entry.componentId === componentId) })
        .filter(({ observation }) => observation?.capability === 'alignable'
            && observation.source.ownership !== 'unverified');
    if (online.some((scan) => scan.plan?.reasonCode === 'version-source-mismatch')) {
        return { kind: 'blocked', reasonCode: 'version-source-mismatch' };
    }
    if (componentId !== 'ego-browser' && online.some((scan) => scan.observation?.reasonCode === 'version-source-mismatch')) {
        return { kind: 'blocked', reasonCode: 'version-source-mismatch' };
    }
    const versions = new Set<string>();
    for (const { observation } of online) {
        if (!observation || observation.support !== 'supported' || !observation.source.available) continue;
        const desired = DesiredComponentStateSchema.safeParse({
            componentId, targetVersion: observation.source.latestVersion,
        });
        if (desired.success) versions.add(desired.data.targetVersion);
    }
    if (versions.size > 1) return { kind: 'blocked', reasonCode: 'version-source-mismatch' };
    const targetVersion = [...versions][0];
    return targetVersion ? { kind: 'ready', targetVersion } : { kind: 'unavailable' };
}

// A lost RPC acknowledgement cannot tell us whether the daemon finished its work.
export function fleetRpcError(error: unknown): Pick<FleetComponentRow, 'status' | 'reasonCode' | 'requiresScan'> {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || /timed?\s*out|timeout/iu.test(error.message));
    return timeout
        ? { status: 'rpc-timeout', reasonCode: 'rpc-timeout', requiresScan: true }
        : { status: 'rpc-error', reasonCode: 'unexpected-error', requiresScan: true };
}

/** Results follow registry order; component observations and plans follow identity. */
export function buildFleetRows(
    machines: readonly Machine[],
    settledResults: readonly PromiseSettledResult<FleetMachineScan>[],
): FleetRow[] {
    return machines.map((machine, index) => {
        const base = { machine, machineId: machine.id, online: isMachineOnline(machine) };
        const settled = settledResults[index];
        return { ...base, components: fleetComponents((componentId) => {
            if (!base.online) return { componentId, status: 'offline', reasonCode: 'machine-offline' };
            if (!settled || settled.status === 'rejected') return { componentId, ...fleetRpcError(settled?.reason) };
            const scan = settled.value;
            const observation = scan.observations?.find((entry) => entry.componentId === componentId);
            if (scan.machineId !== machine.id || !scan.online || !observation) {
                return { componentId, ...fleetRpcError(undefined) };
            }
            const plan = scan.plans?.find((entry) => entry.componentId === componentId);
            const reasonCode = plan?.reasonCode ?? observation.reasonCode;
            const status = reasonCode === 'process-timeout' ? 'process-timeout'
                : plan && plan.action !== 'none' ? plan.action
                : reasonCode || observation.support === 'unsupported' ? 'manual-repair' : 'ready';
            return { componentId, observation, plan, status, reasonCode };
        }) };
    });
}
