import { EnvironmentApplyRequestSchema, EnvironmentInspectRequestSchema } from '@slopus/happy-wire';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type { EnvironmentService } from './environmentService';

export function registerEnvironmentHandlers(
  registrar: Pick<RpcHandlerManager, 'registerHandler'>,
  service: EnvironmentService,
): void {
  registrar.registerHandler('environment-inspect', async (raw: unknown) =>
    service.inspect(EnvironmentInspectRequestSchema.parse(raw)));
  registrar.registerHandler('environment-apply', async (raw: unknown) =>
    service.apply(EnvironmentApplyRequestSchema.parse(raw)));
}
