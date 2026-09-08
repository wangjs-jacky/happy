import { EnvironmentApplyResponseSchema, EnvironmentInspectResponseSchema } from '@slopus/happy-wire';
import type { EnvironmentApplyRequest, EnvironmentApplyResponse, EnvironmentInspectRequest, EnvironmentInspectResponse } from '@slopus/happy-wire';
import { apiSocket } from '@/sync/apiSocket';

const APPLY_RPC_TIMEOUT_MS = 10 * 60_000;

export async function inspectMachineEnvironment(
    machineId: string,
    request: EnvironmentInspectRequest,
    options: { preferV2?: boolean } = {},
): Promise<EnvironmentInspectResponse> {
    if (options.preferV2 === false) {
        const response = await apiSocket.machineRPC<unknown, EnvironmentInspectRequest>(
            machineId, 'environment-inspect', request,
        );
        return EnvironmentInspectResponseSchema.parse(response);
    }
    try {
        const response = await apiSocket.machineRPC<unknown, EnvironmentInspectRequest>(
            machineId, 'environment-inspect-v2', request,
        );
        return EnvironmentInspectResponseSchema.parse(response);
    } catch (error) {
        if (!(error instanceof Error) || (error.message !== 'RPC method not available' && error.message !== 'Method not found')) throw error;
        const response = await apiSocket.machineRPC<unknown, EnvironmentInspectRequest>(
            machineId, 'environment-inspect', request,
        );
        return EnvironmentInspectResponseSchema.parse(response);
    }
}

export async function applyMachineEnvironment(machineId: string, request: EnvironmentApplyRequest): Promise<EnvironmentApplyResponse> {
    const response = await apiSocket.machineRPC<EnvironmentApplyResponse, EnvironmentApplyRequest>(
        machineId, 'environment-apply', request, { timeoutMs: APPLY_RPC_TIMEOUT_MS },
    );
    return EnvironmentApplyResponseSchema.parse(response);
}
