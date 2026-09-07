import { EnvironmentApplyResponseSchema, EnvironmentInspectResponseSchema } from '@slopus/happy-wire';
import type { EnvironmentApplyRequest, EnvironmentApplyResponse, EnvironmentInspectRequest, EnvironmentInspectResponse } from '@slopus/happy-wire';
import { apiSocket } from '@/sync/apiSocket';

const APPLY_RPC_TIMEOUT_MS = 10 * 60_000;

export async function inspectMachineEnvironment(machineId: string, request: EnvironmentInspectRequest): Promise<EnvironmentInspectResponse> {
    const response = await apiSocket.machineRPC<EnvironmentInspectResponse, EnvironmentInspectRequest>(
        machineId, 'environment-inspect', request,
    );
    return EnvironmentInspectResponseSchema.parse(response);
}

export async function applyMachineEnvironment(machineId: string, request: EnvironmentApplyRequest): Promise<EnvironmentApplyResponse> {
    const response = await apiSocket.machineRPC<EnvironmentApplyResponse, EnvironmentApplyRequest>(
        machineId, 'environment-apply', request, { timeoutMs: APPLY_RPC_TIMEOUT_MS },
    );
    return EnvironmentApplyResponseSchema.parse(response);
}
