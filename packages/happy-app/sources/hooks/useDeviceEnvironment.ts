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
    monotonicNow: () => number;
};

type FleetState = Pick<DeviceEnvironmentController, 'phase' | 'rows' | 'target'> & {
    epoch: number;
    registryKey: string;
    previewStartedAt?: number;
    // Unmodified operation outcomes are retained independently of current presence.
    applyRows?: ReadonlyMap<string, FleetRow>;
};

const PLAN_MAX_AGE_MS = 10 * 60_000;

function initialRows(machines: readonly Machine[]): FleetRow[] {
    return machines.map((machine) => ({
        machine, machineId: machine.id, online: isMachineOnline(machine),
        status: isMachineOnline(machine) ? 'pending' : 'offline',
        ...(!isMachineOnline(machine) ? { reasonCode: 'machine-offline' as const } : {}),
    }));
}

function withApplyResults(rows: FleetRow[], applyRows: ReadonlyMap<string, FleetRow>): FleetRow[] {
    const registered = new Set(rows.map((row) => row.machineId));
    const retainedRows = [...rows, ...[...applyRows.values()]
        .filter((row) => !registered.has(row.machineId)).map((row) => ({ ...row, online: false }))];
    return retainedRows.map((row) => {
        const applied = applyRows.get(row.machineId);
        if (!applied) return row;
        return { ...applied, machine: row.machine, online: row.online,
            ...(!row.online ? { status: 'offline' as const, reasonCode: 'machine-offline' as const } : {}) };
    });
}

function inspectionTarget(rows: FleetRow[], desired?: DesiredComponentState): FleetTarget {
    const target = resolveFleetTarget(rows);
    // Keep the scanned target pinned throughout preview, including partial results.
    if (desired && ((target.kind === 'ready' && target.targetVersion !== desired.targetVersion)
        || rows.some((row) => row.plan && row.plan.targetVersion !== desired.targetVersion))) {
        return { kind: 'blocked', reasonCode: 'version-source-mismatch' };
    }
    return target;
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
    const registryKey = JSON.stringify(machines.map((machine) => [machine.id, isMachineOnline(machine)]));
    const latestRegistry = useRef(registryKey);
    latestRegistry.current = registryKey;
    const [state, setState] = useState<FleetState>(() => ({
        epoch: 0, registryKey, phase: 'idle', rows: initialRows(machines), target: { kind: 'unavailable' },
    }));
    const current = useRef(state);
    const latestMachines = useRef(machines);
    latestMachines.current = machines;
    const mounted = useRef(true);
    const applyInFlight = useRef(false);
    const inspect = dependencies.inspect ?? inspectMachineEnvironment;
    const apply = dependencies.apply ?? applyMachineEnvironment;
    const now = dependencies.now ?? Date.now;
    const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());

    function commit(next: FleetState) {
        // A result can settle before the passive registry-reset effect runs.
        // Check both now and when React processes the queued state update.
        if (!mounted.current || next.registryKey !== latestRegistry.current) return;
        current.current = next;
        setState((previous) => previous.epoch > next.epoch || next.registryKey !== latestRegistry.current ? previous : next);
    }

    function update(epoch: number, transform: (previous: FleetState) => FleetState) {
        reconcileRegistry();
        if (mounted.current && current.current.epoch === epoch) commit(transform(current.current));
    }

    function reset() {
        commit({ epoch: current.current.epoch + 1, registryKey: latestRegistry.current,
            phase: 'idle', rows: initialRows(latestMachines.current), target: { kind: 'unavailable' } });
    }

    function reconcileRegistry() {
        const previous = current.current;
        if (previous.registryKey === latestRegistry.current) return;
        if (previous.applyRows && (previous.phase === 'applying' || previous.phase === 'completed')) {
            commit({ ...previous, registryKey: latestRegistry.current, previewStartedAt: undefined,
                rows: withApplyResults(initialRows(latestMachines.current), previous.applyRows), target: { kind: 'unavailable' } });
        } else {
            reset();
        }
    }

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            current.current = { ...current.current, epoch: current.current.epoch + 1 };
        };
    }, []);

    // Membership/presence invalidates reads and approval, while dispatched work
    // retains its epoch and results (including removed devices until explicit reset/scan).
    useEffect(() => {
        reconcileRegistry();
    }, [registryKey]);

    async function inspectFleet(fleet: readonly Machine[], epoch: number, desired?: DesiredComponentState): Promise<FleetRow[]> {
        const results = await Promise.allSettled(fleet.map(async (machine): Promise<FleetMachineScan> => {
            if (!isMachineOnline(machine)) return { machineId: machine.id, online: false };
            function publish(settled: PromiseSettledResult<FleetMachineScan>) {
                const row = buildFleetRows([machine], [settled])[0];
                update(epoch, (latest) => {
                    const rows = latest.rows.map((existing) => existing.machineId === machine.id ? row : existing);
                    return { ...latest, rows, target: inspectionTarget(rows, desired) };
                });
            }
            try {
                const response = await inspect(machine.id, {
                    componentIds: ['github-cli'], ...(desired ? { desired } : {}),
                });
                if (desired && !response.plans?.[0]) throw new Error('Missing daemon plan');
                const scan = { machineId: machine.id, online: true, observation: response.observations[0], plan: desired ? response.plans?.[0] : undefined };
                publish({ status: 'fulfilled', value: scan });
                return scan;
            } catch (reason) {
                publish({ status: 'rejected', reason });
                throw reason;
            }
        }));
        return buildFleetRows(fleet, results);
    }

    async function scan() {
        if (!mounted.current) return;
        const fleet = [...latestMachines.current];
        const epoch = current.current.epoch + 1;
        commit({ epoch, registryKey: latestRegistry.current, phase: 'scanning', rows: initialRows(fleet), target: { kind: 'unavailable' } });
        const rows = await inspectFleet(fleet, epoch);
        update(epoch, (previous) => ({ ...previous, phase: 'scanned', rows, target: resolveFleetTarget(rows) }));
    }

    async function preview() {
        const previous = current.current;
        if (!mounted.current || previous.registryKey !== latestRegistry.current
            || (previous.phase !== 'scanned' && previous.phase !== 'previewed') || previous.target.kind !== 'ready') return;
        const desired: DesiredComponentState = { componentId: 'github-cli', targetVersion: previous.target.targetVersion };
        const epoch = previous.epoch + 1;
        const previewStartedAt = monotonicNow();
        const fleet = [...latestMachines.current];
        commit({ ...previous, epoch, phase: 'previewing', previewStartedAt, rows: initialRows(fleet), target: { kind: 'unavailable' } });
        const rows = await inspectFleet(fleet, epoch, desired);
        update(epoch, (latest) => ({ ...latest, phase: 'previewed', rows, target: inspectionTarget(rows, desired) }));
    }

    async function applyApproved() {
        const previous = current.current;
        if (!mounted.current || previous.registryKey !== latestRegistry.current
            || applyInFlight.current || previous.phase !== 'previewed' || previous.target.kind !== 'ready') return;
        const approvedAt = now();
        const previewAge = previous.previewStartedAt === undefined ? Infinity : monotonicNow() - previous.previewStartedAt;
        // Both timestamps in each plan lifetime come from its daemon. Never compare
        // a daemon expiry directly with the client's wall clock. The daemon remains
        // authoritative on actual issuance/expiry when the request arrives.
        if (previewAge < 0 || previewAge >= PLAN_MAX_AGE_MS
            || previous.rows.some((row) => row.plan && (!row.observation
                || previewAge >= row.plan.expiresAt - row.observation.inspectedAt))) {
            commit({ ...previous, epoch: previous.epoch + 1, phase: 'scanned', previewStartedAt: undefined,
                rows: previous.rows.map((row) => row.plan ? { ...row, plan: undefined, status: 'stale-plan', reasonCode: 'plan-stale' } : row) });
            return;
        }
        const candidates = previous.rows.filter((row) => row.online
            && row.observation?.support === 'supported'
            && (row.status === 'ready' || row.status === 'install' || row.status === 'upgrade')
            && latestMachines.current.some((machine) => machine.id === row.machineId && isMachineOnline(machine))
            && (row.plan?.action === 'none' || row.plan?.action === 'install' || row.plan?.action === 'upgrade'));
        const desired: DesiredComponentState = { componentId: 'github-cli', targetVersion: previous.target.targetVersion };
        const epoch = previous.epoch + 1;
        applyInFlight.current = true;
        commit({ ...previous, epoch, phase: 'applying',
            applyRows: new Map(candidates.map((row) => [row.machineId, { ...row, plan: undefined }])) });
        try {
            await Promise.allSettled(candidates.map(async (row) => {
                function publish(resultRow: FleetRow) {
                    update(epoch, (latest) => {
                        const applyRows = new Map(latest.applyRows);
                        applyRows.set(row.machineId, resultRow);
                        return { ...latest, applyRows, rows: withApplyResults(latest.rows, applyRows) };
                    });
                }
                try {
                    const { result } = await apply(row.machineId, { desired, plan: row.plan!, approvedAt });
                    publish({ ...row, plan: undefined, result, observation: result.after,
                        status: result.reasonCode === 'rpc-timeout' ? 'rpc-timeout' : result.status,
                        reasonCode: result.reasonCode, requiresScan: result.status === 'stale-plan' || result.reasonCode === 'rpc-timeout' });
                } catch (reason) {
                    publish({ ...row, plan: undefined, ...fleetRpcError(reason) });
                    throw reason;
                }
            }));
            update(epoch, (latest) => ({ ...latest, phase: 'completed' }));
        } finally {
            applyInFlight.current = false;
        }
    }

    return { phase: state.phase, rows: state.rows, target: state.target, scan, preview, applyApproved, reset };
}
