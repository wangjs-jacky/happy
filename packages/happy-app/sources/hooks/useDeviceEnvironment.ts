import { useEffect, useRef, useState } from 'react';
import type { DesiredComponentState } from '@slopus/happy-wire';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { applyMachineEnvironment, inspectMachineEnvironment } from '@/environment/environmentOps';
import { buildFleetRows, fleetRpcError, resolveFleetTarget, type FleetMachineScan, type FleetRow, type FleetTarget } from '@/environment/fleetModel';

export type FleetPhase = 'idle' | 'scanning' | 'scanned' | 'previewing' | 'previewed' | 'applying' | 'completed';

export type DeviceEnvironmentController = {
    phase: FleetPhase;
    rows: FleetRow[];
    target: FleetTarget;
    scan(): Promise<void>;
    preview(): Promise<void>;
    applyApproved(): Promise<void>;
    reset(): void;
};

export type DeviceEnvironmentDependencies = {
    inspect: typeof inspectMachineEnvironment;
    apply: typeof applyMachineEnvironment;
    now: () => number;
};

type FleetState = Pick<DeviceEnvironmentController, 'phase' | 'rows' | 'target'> & {
    epoch: number;
    previewStartedAt?: number;
};

const PLAN_MAX_AGE_MS = 10 * 60_000;

function initialRows(machines: readonly Machine[]): FleetRow[] {
    return machines.map((machine) => ({
        machine, machineId: machine.id, online: isMachineOnline(machine),
        status: isMachineOnline(machine) ? 'pending' : 'offline',
        ...(!isMachineOnline(machine) ? { reasonCode: 'machine-offline' as const } : {}),
    }));
}

/**
 * Callers supply the complete registered fleet (including offline machines).
 * Epochs discard superseded reads/results; the synchronous state ref closes the
 * same-render double-click gap. An apply remains locked until its RPCs settle,
 * even if a new scan or reset discards its presentation state.
 */
export function useDeviceEnvironment(
    machines: readonly Machine[],
    dependencies: Partial<DeviceEnvironmentDependencies> = {},
): DeviceEnvironmentController {
    const [state, setState] = useState<FleetState>(() => ({
        epoch: 0, phase: 'idle', rows: initialRows(machines), target: { kind: 'unavailable' },
    }));
    const current = useRef(state);
    const latestMachines = useRef(machines);
    latestMachines.current = machines;
    const mounted = useRef(true);
    const applyInFlight = useRef(false);
    const inspect = dependencies.inspect ?? inspectMachineEnvironment;
    const apply = dependencies.apply ?? applyMachineEnvironment;
    const now = dependencies.now ?? Date.now;
    const registryKey = JSON.stringify(machines.map((machine) => [machine.id, isMachineOnline(machine)]));
    const currentRegistry = useRef(registryKey);

    function commit(next: FleetState) {
        if (!mounted.current) return;
        current.current = next;
        setState((previous) => previous.epoch > next.epoch ? previous : next);
    }

    function update(epoch: number, transform: (previous: FleetState) => FleetState) {
        if (mounted.current && current.current.epoch === epoch) commit(transform(current.current));
    }

    function reset() {
        commit({ epoch: current.current.epoch + 1, phase: 'idle', rows: initialRows(latestMachines.current), target: { kind: 'unavailable' } });
    }

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            current.current = { ...current.current, epoch: current.current.epoch + 1 };
        };
    }, []);

    // A membership/presence change invalidates approval and includes new machines.
    useEffect(() => {
        if (currentRegistry.current !== registryKey) {
            currentRegistry.current = registryKey;
            reset();
        }
    }, [registryKey]);

    async function inspectFleet(fleet: readonly Machine[], desired?: DesiredComponentState): Promise<FleetRow[]> {
        const results = await Promise.allSettled(fleet.map(async (machine): Promise<FleetMachineScan> => {
            if (!isMachineOnline(machine)) return { machineId: machine.id, online: false };
            const response = await inspect(machine.id, {
                componentIds: ['github-cli'], ...(desired ? { desired } : {}),
            });
            if (desired && !response.plans?.[0]) throw new Error('Missing daemon plan');
            return { machineId: machine.id, online: true, observation: response.observations[0], plan: desired ? response.plans?.[0] : undefined };
        }));
        return buildFleetRows(fleet, results);
    }

    async function scan() {
        if (!mounted.current) return;
        const fleet = [...latestMachines.current];
        const epoch = current.current.epoch + 1;
        commit({ epoch, phase: 'scanning', rows: initialRows(fleet), target: { kind: 'unavailable' } });
        const rows = await inspectFleet(fleet);
        update(epoch, (previous) => ({ ...previous, phase: 'scanned', rows, target: resolveFleetTarget(rows) }));
    }

    async function preview() {
        const previous = current.current;
        if (!mounted.current || (previous.phase !== 'scanned' && previous.phase !== 'previewed') || previous.target.kind !== 'ready') return;
        const desired: DesiredComponentState = { componentId: 'github-cli', targetVersion: previous.target.targetVersion };
        const epoch = previous.epoch + 1;
        const previewStartedAt = now();
        commit({ ...previous, epoch, phase: 'previewing', previewStartedAt });
        const rows = await inspectFleet([...latestMachines.current], desired);
        let target = resolveFleetTarget(rows);
        // Approval must retain the target selected by scan, even if every source
        // moved to the same new version while preview was in flight.
        if ((target.kind === 'ready' && target.targetVersion !== desired.targetVersion)
            || rows.some((row) => row.plan && row.plan.targetVersion !== desired.targetVersion)) {
            target = { kind: 'blocked', reasonCode: 'version-source-mismatch' };
        }
        update(epoch, (latest) => ({ ...latest, phase: 'previewed', rows, target }));
    }

    async function applyApproved() {
        const previous = current.current;
        if (!mounted.current || applyInFlight.current || previous.phase !== 'previewed' || previous.target.kind !== 'ready') return;
        const approvedAt = now();
        if (previous.previewStartedAt === undefined || approvedAt - previous.previewStartedAt >= PLAN_MAX_AGE_MS
            || previous.rows.some((row) => row.plan && row.plan.expiresAt <= approvedAt)) {
            commit({ ...previous, epoch: previous.epoch + 1, phase: 'scanned', previewStartedAt: undefined,
                rows: previous.rows.map((row) => row.plan ? { ...row, plan: undefined, status: 'stale-plan', reasonCode: 'plan-stale' } : row) });
            return;
        }
        const candidates = previous.rows.filter((row) => row.online
            && latestMachines.current.some((machine) => machine.id === row.machineId && isMachineOnline(machine))
            && (row.plan?.action === 'install' || row.plan?.action === 'upgrade'));
        const desired: DesiredComponentState = { componentId: 'github-cli', targetVersion: previous.target.targetVersion };
        const epoch = previous.epoch + 1;
        applyInFlight.current = true;
        commit({ ...previous, epoch, phase: 'applying' });
        try {
            const results = await Promise.allSettled(candidates.map(async (row) => apply(row.machineId, {
                desired, plan: row.plan!, approvedAt,
            })));
            const byMachine = new Map(candidates.map((row, index) => [row.machineId, results[index]]));
            update(epoch, (latest) => ({ ...latest, phase: 'completed', rows: latest.rows.map((row) => {
                const settled = byMachine.get(row.machineId);
                if (!settled) return row;
                if (settled.status === 'rejected') return { ...row, plan: undefined, ...fleetRpcError(settled.reason) };
                const result = settled.value.result;
                return { ...row, plan: undefined, result, observation: result.after,
                    status: result.reasonCode === 'rpc-timeout' ? 'rpc-timeout' : result.status,
                    reasonCode: result.reasonCode, requiresScan: result.status === 'stale-plan' || result.reasonCode === 'rpc-timeout' };
            }) }));
        } finally {
            applyInFlight.current = false;
        }
    }

    return { phase: state.phase, rows: state.rows, target: state.target, scan, preview, applyApproved, reset };
}
