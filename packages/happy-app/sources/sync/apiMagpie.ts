import { MagpieActionSchema, MagpieSnapshotSchema, type MagpieAction, type MagpieSnapshot } from '@slopus/happy-wire';
import { apiSocket } from './apiSocket';

/** One user action, one encrypted machine RPC. Writes are never retried. */
export async function machineMagpie(machineId: string, action: MagpieAction): Promise<MagpieSnapshot> {
    return MagpieSnapshotSchema.parse(await apiSocket.machineRPC(machineId, 'magpie-control', MagpieActionSchema.parse(action), {
        timeoutMs: 150_000, overallTimeoutMs: 150_000,
    }));
}
