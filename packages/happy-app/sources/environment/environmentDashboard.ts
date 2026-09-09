import { DesiredComponentStateSchema, type ComponentObservation, type ComponentApplyResult, type EnvironmentComponentId, type EnvironmentReasonCode } from '@slopus/happy-wire';
import type { Machine } from '@/sync/storageTypes';
import type { applyMachineEnvironment, inspectMachineEnvironment } from './environmentOps';
import { FLEET_COMPONENT_IDS } from './fleetModel';

export type EnvironmentCellPhase = 'idle' | 'checking' | 'queued' | 'preparing' | 'updating' | 'succeeded' | 'failed' | 'uncertain' | 'unknown' | 'changed';
export type EnvironmentCell = {
    componentId: EnvironmentComponentId;
    phase: EnvironmentCellPhase;
    observation?: ComponentObservation;
    reasonCode?: EnvironmentReasonCode;
    result?: ComponentApplyResult;
    checkedAt?: number;
};
export type EnvironmentRow = { machine: Machine; cells: Record<EnvironmentComponentId, EnvironmentCell>; unresolved?: boolean };
export type EnvironmentBatch = { total: number; done: number; succeeded: number; failed: number; uncertain: number; skipped: number };
export type EnvironmentDashboardSnapshot = { rows: EnvironmentRow[]; scanning: boolean; running: boolean; lastChecked?: number; batch?: EnvironmentBatch };
export type EnvironmentScope = { machineId?: string; componentId?: EnvironmentComponentId };
export type EnvironmentAction = 'upgrade' | 'install' | 'authenticate' | 'repair' | 'manual' | null;
export type EnvironmentCellDescription = {
    state: 'unknown' | 'unsupported' | 'source' | 'missing' | 'update' | 'latest' | 'ahead' | 'login' | 'pairing' | 'optional-login' | 'manual';
    action: EnvironmentAction;
    target?: string;
};

/** Compare three/four-part versions, including prereleases; reject unparseable input. */
function compare(left: string, right: string): number | null {
    const parse = (value: string) => /^(\d+(?:\.\d+){2,3})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value);
    const a = parse(left), b = parse(right);
    if (!a || !b) return null;
    const numeric = (x: string, y: string) => BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0;
    const av = a[1].split('.'), bv = b[1].split('.');
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        const order = numeric(av[i] ?? '0', bv[i] ?? '0');
        if (order) return order;
    }
    if (a[2] === b[2]) return 0;
    if (!a[2]) return 1;
    if (!b[2]) return -1;
    const ap = a[2].split('.'), bp = b[2].split('.');
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
        if (ap[i] === bp[i]) continue;
        if (ap[i] === undefined) return -1;
        if (bp[i] === undefined) return 1;
        const an = /^\d+$/u.test(ap[i]), bn = /^\d+$/u.test(bp[i]);
        return an && bn ? numeric(ap[i], bp[i]) : an !== bn ? (an ? -1 : 1) : ap[i] < bp[i] ? -1 : 1;
    }
    return 0;
}

/** Installation, package freshness and account/setup readiness are independent. */
export function describeEnvironmentCell(cell: EnvironmentCell): EnvironmentCellDescription {
    const o = cell.observation;
    if (!o || ['unknown', 'uncertain', 'changed'].includes(cell.phase)
        || ['unexpected-error', 'process-timeout', 'rpc-timeout', 'operation-in-progress'].includes(o.reasonCode ?? '')) return { state: 'unknown', action: null };
    if (o.support !== 'supported') return { state: 'unsupported', action: 'manual' };
    const target = DesiredComponentStateSchema.safeParse({ componentId: o.componentId, targetVersion: o.source.latestVersion });
    const version = target.success ? target.data.targetVersion : undefined;
    if (o.componentId === 'ego-browser' && o.details.kind === 'ego-browser') {
        if (!o.installed || !o.details.appVersion || !o.details.pathReady) return { state: 'pairing', action: 'manual', target: version };
        if (!o.details.paired) return { state: 'pairing', action: o.capability === 'alignable' && version ? 'repair' : 'manual', target: version };
        return { state: 'latest', action: null };
    }
    const managed = o.capability === 'alignable' && o.source.available && Boolean(version)
        && (o.installed ? o.source.ownership === 'verified' : o.resolvedExecutable === null);
    if (!o.installed) return { state: 'missing', action: managed ? 'install' : 'manual', target: version };
    if (!o.installedVersion) return { state: 'unknown', action: null };
    if (o.source.ownership === 'unverified') return { state: 'manual', action: 'manual', target: version };
    if (!version || !o.source.available) return { state: 'source', action: 'manual' };
    const comparison = compare(o.installedVersion, version);
    if (comparison === null) return { state: 'unknown', action: null };
    if (comparison > 0) return { state: 'ahead', action: null, target: version };
    if (comparison < 0) return { state: 'update', action: managed ? 'upgrade' : 'manual', target: version };
    if (o.componentId === 'github-cli' || o.componentId === 'cloudflare-wrangler') {
        if (o.authentication?.status !== 'authenticated') return { state: 'login', action: managed && o.componentId === 'cloudflare-wrangler' && o.authentication?.status === 'missing' ? 'authenticate' : 'manual', target: version };
    }
    // Quick tunnels do not need a tunnel login certificate. Offer account setup in details only.
    if (o.componentId === 'cloudflared' && o.details.kind === 'cloudflared' && !o.details.tunnelCertificatePresent) return { state: 'optional-login', action: null, target: version };
    return { state: 'latest', action: null, target: version };
}

export type EnvironmentDashboardDependencies = {
    inspect: typeof inspectMachineEnvironment;
    apply: typeof applyMachineEnvironment;
    machines(): Machine[];
    active(): boolean;
    ready?(): boolean;
    now(): number;
};
export type EnvironmentDashboardStore = ReturnType<typeof createEnvironmentDashboard>;
const busyPhases: EnvironmentCellPhase[] = ['queued', 'preparing', 'updating'];

/** A runtime task owner, independent of modal mounts. No credentials or plans are persisted. */
export function createEnvironmentDashboard(deps: EnvironmentDashboardDependencies) {
    let state: EnvironmentDashboardSnapshot = { rows: [], scanning: false, running: false };
    const listeners = new Set<() => void>();
    // Inspection alone cannot prove a disconnected remote installer has stopped.
    const unresolvedMachines = new Set<string>();
    let pendingScan = false;
    const publish = (patch: Partial<EnvironmentDashboardSnapshot>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
    const patchCell = (machineId: string, id: EnvironmentComponentId, patch: Partial<EnvironmentCell>) => publish({
        rows: state.rows.map(row => row.machine.id !== machineId ? row : { ...row, cells: { ...row.cells, [id]: { ...row.cells[id], ...patch } } }),
    });
    const ready = () => deps.ready?.() !== false;
    const currentMachine = (id: string) => deps.active() && ready() && deps.machines().some(m => m.id === id && m.active);
    function setMachines(machines: Machine[]) {
        const previous = new Map(state.rows.map(row => [row.machine.id, row]));
        const rows = machines.map(machine => {
            const row = previous.get(machine.id);
            const reconnected = row && !row.machine.active && machine.active;
            const cells = row?.cells ?? Object.fromEntries(FLEET_COMPONENT_IDS.map(componentId => [componentId, { componentId, phase: 'idle' }])) as EnvironmentRow['cells'];
            return row?.machine === machine ? row : { machine, unresolved: unresolvedMachines.has(machine.id),
                cells: reconnected ? Object.fromEntries(FLEET_COMPONENT_IDS.map(id => [id,
                    busyPhases.includes(cells[id].phase) || cells[id].phase === 'uncertain' ? cells[id] : { ...cells[id], phase: 'unknown', result: undefined },
                ])) as EnvironmentRow['cells'] : cells };
        });
        // A removed running machine remains visible until its outcome is known.
        if (state.running) for (const row of state.rows) if (!machines.some(m => m.id === row.machine.id)) rows.push({ ...row, machine: { ...row.machine, active: false } });
        if (rows.length !== state.rows.length || rows.some((row, i) => row !== state.rows[i])) publish({ rows });
    }

    async function scan() {
        if (!deps.active() || !ready()) return;
        if (state.running || state.scanning) { pendingScan = true; return; }
        pendingScan = false;
        setMachines(deps.machines());
        const fleet = [...state.rows];
        publish({ scanning: true, batch: undefined });
        await Promise.allSettled(fleet.filter(row => row.machine.active).map(async row => {
            for (const id of FLEET_COMPONENT_IDS) if (row.cells[id].phase !== 'uncertain') patchCell(row.machine.id, id, { phase: 'checking', result: undefined });
            try {
                const response = await deps.inspect(row.machine.id, { componentIds: [...FLEET_COMPONENT_IDS] });
                if (!deps.active()) return;
                for (const id of FLEET_COMPONENT_IDS) {
                    if (row.cells[id].phase === 'uncertain') continue;
                    const observation = response.observations.find(o => o.componentId === id);
                    patchCell(row.machine.id, id, { ...(observation ? { observation } : {}), phase: observation ? 'idle' : 'unknown',
                        reasonCode: observation?.reasonCode, checkedAt: deps.now(), result: undefined });
                }
            } catch {
                for (const id of FLEET_COMPONENT_IDS) if (row.cells[id].phase !== 'uncertain') patchCell(row.machine.id, id, { phase: 'unknown', reasonCode: 'unexpected-error', result: undefined });
            }
        }));
        setMachines(deps.machines());
        publish({ scanning: false, lastChecked: deps.now() });
        if (pendingScan) await scan();
    }

    function getCandidates(scope: EnvironmentScope = {}) {
        if (!deps.active() || !ready()) return [];
        return state.rows.filter(row => row.machine.active && !unresolvedMachines.has(row.machine.id) && (!scope.machineId || scope.machineId === row.machine.id))
            .flatMap(row => FLEET_COMPONENT_IDS.filter(id => !scope.componentId || scope.componentId === id)
                .filter(id => !busyPhases.includes(row.cells[id].phase) && describeEnvironmentCell(row.cells[id]).action === 'upgrade')
                .map(componentId => ({ machineId: row.machine.id, componentId })));
    }

    type Task = { machineId: string; componentId: EnvironmentComponentId; action: Exclude<EnvironmentAction, 'manual' | null>; observation: ComponentObservation; targetVersion: string };
    async function execute(tasks: Task[]) {
        if (!tasks.length || state.running || state.scanning || !deps.active() || !ready()) return;
        publish({ running: true, batch: { total: tasks.length, done: 0, succeeded: 0, failed: 0, uncertain: 0, skipped: 0 } });
        for (const task of tasks) patchCell(task.machineId, task.componentId, { phase: 'queued', reasonCode: undefined, result: undefined });
        const finish = (task: Task, outcome: 'succeeded' | 'failed' | 'uncertain' | 'skipped') => {
            if (outcome === 'uncertain') {
                unresolvedMachines.add(task.machineId);
                publish({ rows: state.rows.map(row => row.machine.id === task.machineId ? { ...row, unresolved: true } : row) });
            }
            const batch = state.batch!;
            publish({ batch: { ...batch, done: batch.done + 1, [outcome]: batch[outcome] + 1 } });
        };
        await Promise.allSettled([...new Set(tasks.map(task => task.machineId))].map(async machineId => {
            let uncertain = false;
            for (const task of tasks.filter(task => task.machineId === machineId)) {
                const { componentId, targetVersion, observation: approvedObservation } = task;
                if (uncertain || !currentMachine(machineId)) {
                    patchCell(machineId, componentId, { phase: uncertain ? 'uncertain' : 'idle', reasonCode: uncertain ? 'operation-in-progress' : 'machine-offline' });
                    finish(task, 'skipped'); continue;
                }
                let dispatched = false;
                try {
                    patchCell(machineId, componentId, { phase: 'preparing' });
                    const desired = { componentId, targetVersion };
                    const prepared = await deps.inspect(machineId, { componentIds: [componentId], desired });
                    if (!currentMachine(machineId)) { patchCell(machineId, componentId, { phase: 'idle' }); finish(task, 'skipped'); continue; }
                    const observed = prepared.observations.find(o => o.componentId === componentId);
                    const plan = prepared.plans?.find(p => p.componentId === componentId);
                    const action = task.action === 'repair' ? 'upgrade' : task.action;
                    // Never silently change target, executable ownership or action after the click.
                    const unchanged = observed && observed.support === 'supported' && observed.capability === 'alignable'
                        && observed.installed === approvedObservation.installed && observed.installedVersion === approvedObservation.installedVersion
                        && observed.resolvedExecutable === approvedObservation.resolvedExecutable
                        && observed.source.kind === approvedObservation.source.kind && observed.source.ownership === approvedObservation.source.ownership
                        && observed.source.available && observed.source.latestVersion === targetVersion;
                    if (!unchanged || !plan || plan.action !== action || plan.fromVersion !== approvedObservation.installedVersion || plan.targetVersion !== targetVersion) {
                        patchCell(machineId, componentId, { ...(observed ? { observation: observed } : {}), phase: 'changed', reasonCode: plan?.reasonCode ?? 'plan-stale' });
                        finish(task, 'skipped'); continue;
                    }
                    patchCell(machineId, componentId, { phase: 'updating', observation: observed });
                    dispatched = true;
                    const { result } = await deps.apply(machineId, { desired, plan, approvedAt: deps.now() });
                    if (result.componentId !== componentId || result.before.componentId !== componentId || result.after.componentId !== componentId) throw new Error('Mismatched result');
                    const isUnknown = result.reasonCode === 'rpc-timeout' || result.reasonCode === 'process-timeout'
                        || result.reasonCode === 'operation-in-progress' || result.after.reasonCode === 'operation-in-progress'
                        || result.after.reasonCode === 'unexpected-error' || (result.status === 'succeeded' && result.after.installedVersion !== targetVersion);
                    const phase = isUnknown ? 'uncertain' : result.status === 'succeeded' ? 'succeeded' : result.status === 'stale-plan' ? 'changed' : 'failed';
                    patchCell(machineId, componentId, { phase, observation: result.after, result, reasonCode: result.reasonCode, checkedAt: deps.now() });
                    uncertain = isUnknown;
                    finish(task, isUnknown ? 'uncertain' : result.status === 'succeeded' ? 'succeeded' : result.status === 'stale-plan' ? 'skipped' : 'failed');
                } catch {
                    uncertain = dispatched;
                    patchCell(machineId, componentId, { phase: dispatched ? 'uncertain' : 'unknown', reasonCode: dispatched ? 'rpc-timeout' : 'unexpected-error' });
                    finish(task, dispatched ? 'uncertain' : 'failed');
                }
            }
        }));
        publish({ running: false });
        setMachines(deps.machines());
        if (pendingScan) await scan();
    }

    function taskFor(machineId: string, componentId: EnvironmentComponentId): Task | undefined {
        const row = state.rows.find(row => row.machine.id === machineId);
        const cell = row?.cells[componentId];
        if (!row?.machine.active || unresolvedMachines.has(machineId) || !cell?.observation || busyPhases.includes(cell.phase)) return;
        const { action, target } = describeEnvironmentCell(cell);
        if (!target || !action || action === 'manual') return;
        return { machineId, componentId, action, observation: cell.observation, targetVersion: target };
    }
    return {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        setMachines, scan, getCandidates,
        // Only call after explicit user attestation that the remote process ended.
        confirmStopped: async (machineId: string) => {
            if (state.running || state.scanning || !currentMachine(machineId) || !unresolvedMachines.has(machineId)) return;
            unresolvedMachines.delete(machineId);
            publish({ rows: state.rows.map(row => row.machine.id === machineId ? { ...row, unresolved: false,
                cells: Object.fromEntries(FLEET_COMPONENT_IDS.map(id => [id, { ...row.cells[id], phase: 'unknown', result: undefined }])) as EnvironmentRow['cells'],
            } : row) });
            await scan();
        },
        update: (scope: EnvironmentScope = {}) => execute(getCandidates(scope).map(({ machineId, componentId }) => taskFor(machineId, componentId)).filter((task): task is Task => Boolean(task))),
        runSingle: (machineId: string, componentId: EnvironmentComponentId) => { const task = taskFor(machineId, componentId); return execute(task ? [task] : []); },
    };
}
