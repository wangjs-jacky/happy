import { useEffect, useRef, useState } from 'react';
import type { AlignableEnvironmentComponentId, DesiredComponentState, EnvironmentComponentId } from '@slopus/happy-wire';
import type { Machine } from '@/sync/storageTypes';
import { isMachineOnline } from '@/utils/machineUtils';
import { applyMachineEnvironment, inspectMachineEnvironment } from '@/environment/environmentOps';
import { buildFleetRows, fleetComponents, FLEET_COMPONENT_IDS, fleetRpcError, resolveFleetTarget, type FleetComponentRow, type FleetMachineScan, type FleetRow, type FleetTarget } from '@/environment/fleetModel';

export type FleetPhase = 'idle' | 'scanning' | 'scanned' | 'previewing' | 'previewed' | 'applying' | 'completed';

export type DeviceEnvironmentController = {
    phase: FleetPhase;
    rows: FleetRow[];
    target: FleetTarget;
    targets: Record<AlignableEnvironmentComponentId, FleetTarget>;
    selectedComponent: AlignableEnvironmentComponentId;
    selectComponent(componentId: EnvironmentComponentId): void;
    scan(): Promise<void>;
    preview(componentId?: EnvironmentComponentId): Promise<void>;
    applyApproved(componentId?: EnvironmentComponentId): Promise<void>;
    reset(): void;
};

export type DeviceEnvironmentDependencies = {
    inspect: typeof inspectMachineEnvironment;
    apply: typeof applyMachineEnvironment;
    now: () => number;
    monotonicNow: () => number;
};

type FleetState = Pick<DeviceEnvironmentController, 'phase' | 'rows' | 'target' | 'selectedComponent'> & {
    epoch: number;
    registryKey: string;
    requiresFleetScan?: boolean;
    previewStartedAt?: number;
    // Unmodified operation outcomes are retained independently of current presence.
    applyRows?: ReadonlyMap<string, FleetRow>;
};

function isAlignable(componentId: EnvironmentComponentId): componentId is AlignableEnvironmentComponentId {
    return FLEET_COMPONENT_IDS.includes(componentId);
}

function replaceComponent(row: FleetRow, component: FleetComponentRow): FleetRow {
    return { ...row, components: { ...row.components, [component.componentId]: component } };
}

function clearPlans(rows: FleetRow[]): FleetRow[] {
    return rows.map((row) => ({ ...row, components: fleetComponents((id) => ({ ...row.components[id], plan: undefined })) }));
}

const PLAN_MAX_AGE_MS = 10 * 60_000;

function initialRows(machines: readonly Machine[]): FleetRow[] {
    return machines.map((machine) => ({
        machine, machineId: machine.id, online: isMachineOnline(machine),
        components: fleetComponents((componentId) => ({
            componentId, status: isMachineOnline(machine) ? 'pending' : 'offline',
            ...(!isMachineOnline(machine) ? { reasonCode: 'machine-offline' as const } : {}),
        })),
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
            components: fleetComponents((componentId) => ({
                ...applied.components[componentId],
                ...(!row.online ? { status: 'offline' as const, reasonCode: 'machine-offline' as const } : {}),
            })) };
    });
}

function inspectionTarget(rows: FleetRow[], componentId: AlignableEnvironmentComponentId, desired?: DesiredComponentState): FleetTarget {
    const target = resolveFleetTarget(rows, componentId);
    // Keep the scanned target pinned throughout preview, including partial results.
    if (desired && ((target.kind === 'ready' && target.targetVersion !== desired.targetVersion)
        || rows.some((row) => row.components[componentId].plan && row.components[componentId].plan!.targetVersion !== desired.targetVersion))) {
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
        epoch: 0, registryKey, selectedComponent: 'github-cli', phase: 'idle', rows: initialRows(machines), target: { kind: 'unavailable' },
    }));
    const current = useRef(state);
    const latestMachines = useRef(machines);
    latestMachines.current = machines;
    const mounted = useRef(true);
    const applyInFlight = useRef(false);
    // Synchronized version records may lag behind the running daemon. Negotiate
    // the RPC capability directly; inspectMachineEnvironment falls back to the
    // legacy endpoint only when the server reports that v2 is unavailable.
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
            selectedComponent: current.current.selectedComponent, phase: 'idle', rows: initialRows(latestMachines.current), target: { kind: 'unavailable' } });
    }

    function reconcileRegistry() {
        const previous = current.current;
        if (previous.registryKey === latestRegistry.current) return;
        if (previous.applyRows) {
            // Archive dispatched outcomes, but refresh sibling checks before
            // presence overlays replace their statuses with "offline".
            const applyRows = new Map(previous.applyRows);
            for (const row of previous.rows) {
                const archived = applyRows.get(row.machineId);
                if (!archived) continue;
                applyRows.set(row.machineId, { ...archived, components: fleetComponents((id) => {
                    const outcome = archived.components[id];
                    const latest = row.components[id];
                    return { ...(outcome.dispatchedAction || latest.status === 'offline' ? outcome : latest),
                        // Historical apply evidence does not own a newer check's status or observation.
                        result: latest.result ?? outcome.result, plan: undefined };
                }) });
            }
            const retainsPhase = previous.phase === 'applying' || previous.phase === 'completed';
            commit({ ...previous, epoch: retainsPhase ? previous.epoch : previous.epoch + 1,
                phase: retainsPhase ? previous.phase : 'idle', registryKey: latestRegistry.current,
                requiresFleetScan: true, previewStartedAt: undefined,
                applyRows, rows: withApplyResults(initialRows(latestMachines.current), applyRows), target: { kind: 'unavailable' } });
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
                    const rows = latest.rows.map((existing) => existing.machineId === machine.id
                        ? desired ? replaceComponent(existing, row.components[desired.componentId]) : row : existing);
                    return { ...latest, rows, target: inspectionTarget(rows, desired?.componentId ?? latest.selectedComponent, desired) };
                });
            }
            try {
                const response = await inspect(machine.id, {
                    componentIds: desired ? [desired.componentId] : [...FLEET_COMPONENT_IDS], ...(desired ? { desired } : {}),
                });
                const scan: FleetMachineScan = { machineId: machine.id, online: true,
                    observations: response.observations, plans: desired ? response.plans : undefined };
                if (desired && !response.plans?.some((plan) => plan.componentId === desired.componentId)) {
                    // Missing approval affects only this component; retain the successful observation.
                    scan.plans = undefined;
                    const row = buildFleetRows([machine], [{ status: 'fulfilled', value: scan }])[0];
                    row.components[desired.componentId] = { ...row.components[desired.componentId], ...fleetRpcError(undefined) };
                    update(epoch, (latest) => {
                        const rows = latest.rows.map((existing) => existing.machineId === machine.id
                            ? replaceComponent(existing, row.components[desired.componentId]) : existing);
                        return { ...latest, rows, target: inspectionTarget(rows, desired.componentId, desired) };
                    });
                    return scan;
                }
                publish({ status: 'fulfilled', value: scan });
                return scan;
            } catch (reason) {
                publish({ status: 'rejected', reason });
                throw reason;
            }
        }));
        return current.current.epoch === epoch ? current.current.rows : buildFleetRows(fleet, results);
    }

    async function scan() {
        if (!mounted.current) return;
        const fleet = [...latestMachines.current];
        const epoch = current.current.epoch + 1;
        commit({ epoch, registryKey: latestRegistry.current, selectedComponent: current.current.selectedComponent, phase: 'scanning', rows: initialRows(fleet), target: { kind: 'unavailable' } });
        const rows = await inspectFleet(fleet, epoch);
        update(epoch, (previous) => ({ ...previous, phase: 'scanned', rows, target: resolveFleetTarget(rows, previous.selectedComponent) }));
    }

    function selectComponent(componentId: EnvironmentComponentId) {
        const previous = current.current;
        if (!isAlignable(componentId) || componentId === previous.selectedComponent || applyInFlight.current
            || previous.registryKey !== latestRegistry.current || previous.phase === 'scanning') return;
        const rows = clearPlans(previous.rows);
        commit({ ...previous, epoch: previous.epoch + 1, selectedComponent: componentId,
            phase: previous.phase === 'idle' || previous.requiresFleetScan ? 'idle' : 'scanned', previewStartedAt: undefined,
            rows, target: previous.requiresFleetScan ? { kind: 'unavailable' } : resolveFleetTarget(rows, componentId) });
    }

    async function preview(componentId: EnvironmentComponentId = current.current.selectedComponent) {
        const previous = current.current;
        if (!isAlignable(componentId) || !mounted.current || previous.requiresFleetScan || previous.registryKey !== latestRegistry.current
            || (previous.phase !== 'scanned' && previous.phase !== 'previewed'
                && !(previous.phase === 'completed' && componentId !== previous.selectedComponent))) return;
        // An unknown mutation outcome cannot be cleared by changing selection.
        // Failed reads without observations still allow healthy fleet peers.
        if (previous.rows.some((row) => row.online && row.components[componentId].requiresScan
            && row.components[componentId].observation)) return;
        const target = componentId === previous.selectedComponent ? previous.target : resolveFleetTarget(previous.rows, componentId);
        if (target.kind !== 'ready') return;
        const desired: DesiredComponentState = { componentId, targetVersion: target.targetVersion };
        const epoch = previous.epoch + 1;
        const previewStartedAt = monotonicNow();
        const fleet = latestMachines.current.filter((machine) => {
            const observation = previous.rows.find((row) => row.machineId === machine.id)?.components[componentId].observation;
            return observation?.capability === 'alignable' && observation.source.ownership !== 'unverified';
        });
        const rows = clearPlans(previous.rows).map((row) => row.components[componentId].observation?.capability !== 'alignable'
            || row.components[componentId].observation?.source.ownership === 'unverified'
            ? row : replaceComponent(row, {
            componentId, status: row.online ? 'pending' : 'offline',
            ...(!row.online ? { reasonCode: 'machine-offline' as const } : {}),
        }));
        commit({ ...previous, epoch, selectedComponent: componentId, phase: 'previewing', previewStartedAt,
            rows, target: { kind: 'unavailable' } });
        const inspectedRows = await inspectFleet(fleet, epoch, desired);
        update(epoch, (latest) => ({ ...latest, phase: 'previewed', rows: inspectedRows,
            target: inspectionTarget(inspectedRows, componentId, desired) }));
    }

    async function applyApproved(componentId: EnvironmentComponentId = state.selectedComponent) {
        const previous = current.current;
        if (!isAlignable(componentId) || componentId !== previous.selectedComponent
            || previous.epoch !== state.epoch
            || !mounted.current || previous.registryKey !== latestRegistry.current
            || applyInFlight.current || previous.phase !== 'previewed' || previous.target.kind !== 'ready') return;
        const approvedAt = now();
        const previewAge = previous.previewStartedAt === undefined ? Infinity : monotonicNow() - previous.previewStartedAt;
        // Both timestamps in each plan lifetime come from its daemon. Never compare
        // a daemon expiry directly with the client's wall clock. The daemon remains
        // authoritative on actual issuance/expiry when the request arrives.
        if (previewAge < 0 || previewAge >= PLAN_MAX_AGE_MS
            || previous.rows.some((row) => row.components[componentId].plan && (!row.components[componentId].observation
                || previewAge >= row.components[componentId].plan.expiresAt - row.components[componentId].observation.inspectedAt))) {
            commit({ ...previous, epoch: previous.epoch + 1, phase: 'scanned', previewStartedAt: undefined,
                rows: previous.rows.map((row) => row.components[componentId].plan ? replaceComponent(row, {
                    ...row.components[componentId], plan: undefined, status: 'stale-plan', reasonCode: 'plan-stale',
                }) : row) });
            return;
        }
        const candidates = previous.rows.filter((row) => row.online
            && row.components[componentId].observation?.support === 'supported'
            && row.components[componentId].observation?.capability === 'alignable'
            && row.components[componentId].observation?.source.ownership !== 'unverified'
            && (row.components[componentId].status === 'ready' || row.components[componentId].status === 'install'
                || row.components[componentId].status === 'upgrade' || row.components[componentId].status === 'authenticate'
                || row.components[componentId].status === 'onboard')
            && latestMachines.current.some((machine) => machine.id === row.machineId && isMachineOnline(machine))
            && row.components[componentId].plan?.action !== 'manual-repair');
        const desired: DesiredComponentState = { componentId, targetVersion: previous.target.targetVersion };
        const epoch = previous.epoch + 1;
        applyInFlight.current = true;
        const applyRows = new Map(previous.applyRows);
        for (const row of clearPlans(previous.rows)) {
            if (applyRows.has(row.machineId)) applyRows.set(row.machineId, row);
        }
        for (const row of candidates) applyRows.set(row.machineId, replaceComponent(row, {
            ...row.components[componentId], plan: undefined,
            dispatchedAction: {
                action: row.components[componentId].plan!.action,
                fromVersion: row.components[componentId].plan!.fromVersion,
                targetVersion: row.components[componentId].plan!.targetVersion,
            },
        }));
        commit({ ...previous, epoch, phase: 'applying',
            applyRows, rows: withApplyResults(previous.rows, applyRows) });
        try {
            await Promise.allSettled(candidates.map(async (row) => {
                function publish(resultComponent: FleetComponentRow) {
                    update(epoch, (latest) => {
                        const applyRows = new Map(latest.applyRows);
                        applyRows.set(row.machineId, replaceComponent(row, resultComponent));
                        return { ...latest, applyRows, rows: withApplyResults(latest.rows, applyRows) };
                    });
                }
                try {
                    const { result } = await apply(row.machineId, { desired, plan: row.components[componentId].plan!, approvedAt });
                    if (result.componentId !== componentId || result.before.componentId !== componentId || result.after.componentId !== componentId) {
                        throw new Error('Mismatched component result');
                    }
                    publish({ ...row.components[componentId], plan: undefined, dispatchedAction: undefined, result, observation: result.after,
                        status: result.reasonCode === 'rpc-timeout' ? 'rpc-timeout'
                            : result.reasonCode === 'process-timeout' ? 'process-timeout' : result.status,
                        reasonCode: result.reasonCode, requiresScan: result.status === 'stale-plan'
                            || result.reasonCode === 'rpc-timeout' || result.reasonCode === 'process-timeout' });
                } catch (reason) {
                    publish({ ...row.components[componentId], plan: undefined, dispatchedAction: undefined, ...fleetRpcError(reason) });
                    throw reason;
                }
            }));
            update(epoch, (latest) => ({ ...latest, phase: 'completed' }));
        } finally {
            applyInFlight.current = false;
        }
    }

    return { phase: state.phase, rows: state.rows, target: state.target, selectedComponent: state.selectedComponent,
        targets: Object.fromEntries(FLEET_COMPONENT_IDS.map((componentId) => [componentId,
            state.requiresFleetScan ? { kind: 'unavailable' }
                : state.selectedComponent === componentId ? state.target : resolveFleetTarget(state.rows, componentId),
        ])) as Record<AlignableEnvironmentComponentId, FleetTarget>,
        selectComponent, scan, preview, applyApproved, reset };
}
