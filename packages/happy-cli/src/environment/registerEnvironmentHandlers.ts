import { EnvironmentApplyRequestSchema, EnvironmentInspectRequestSchema, type EnvironmentInspectResponse } from '@slopus/happy-wire';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type { EnvironmentService } from './environmentService';

export function registerEnvironmentHandlers(
  registrar: Pick<RpcHandlerManager, 'registerHandler'>,
  service: EnvironmentService,
): void {
  registrar.registerHandler('environment-inspect', async (raw: unknown) => {
    const request = EnvironmentInspectRequestSchema.parse(raw);
    if (request.desired?.componentId === 'ego-browser' || request.desired?.componentId === 'cloudflare-wrangler'
      || request.desired?.componentId === 'cloudflared') {
      throw new Error('This component requires environment-inspect-v2');
    }
    const response = await service.inspect(request);
    const observations: EnvironmentInspectResponse['observations'] = response.observations.map((observation) =>
      observation.componentId === 'ego-browser' || observation.componentId === 'cloudflare-wrangler' || observation.componentId === 'cloudflared'
        ? { ...observation, capability: 'inspect-only' as const }
        : observation);
    return { ...response, observations };
  });
  registrar.registerHandler('environment-inspect-v2', async (raw: unknown) =>
    service.inspect(EnvironmentInspectRequestSchema.parse(raw)));
  registrar.registerHandler('environment-apply', async (raw: unknown) =>
    service.apply(EnvironmentApplyRequestSchema.parse(raw)));
}
