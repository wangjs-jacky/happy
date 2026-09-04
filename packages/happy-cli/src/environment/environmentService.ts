import {
  ComponentObservationSchema,
  ComponentPlanSchema,
  EnvironmentApplyRequestSchema,
  EnvironmentComponentIdSchema,
  EnvironmentInspectRequestSchema,
  type ComponentApplyResult,
  type ComponentObservation,
  type ComponentPlan,
  type DesiredComponentState,
  type EnvironmentApplyRequest,
  type EnvironmentApplyResponse,
  type EnvironmentComponentId,
  type EnvironmentInspectRequest,
  type EnvironmentInspectResponse,
  type EnvironmentReasonCode,
  type RepairGuide,
} from '@slopus/happy-wire';
import type { EnvironmentComponentAdapter } from './componentAdapter';
import type { ProcessResult } from './processRunner';

export interface EnvironmentService {
  inspect(request: EnvironmentInspectRequest): Promise<EnvironmentInspectResponse>;
  apply(request: EnvironmentApplyRequest): Promise<EnvironmentApplyResponse>;
}

const MAX_ISSUED_PLANS = 128;
const REPAIR_COMMANDS: Partial<Record<EnvironmentReasonCode, readonly string[]>> = {
  'homebrew-missing': ['command -v brew'],
  'formula-unavailable': ['brew info gh'],
  'version-source-mismatch': ['command -v gh', 'gh --version', 'brew info gh'],
  'version-ahead': ['gh --version', 'brew info gh'],
  'authentication-missing': ['gh auth login --hostname github.com'],
  'install-failed': ['brew doctor', 'brew info gh'],
  'verification-failed': ['gh --version', 'brew info gh'],
  'unexpected-error': ['gh --version', 'brew info gh'],
};

function repairGuide(reasonCode: EnvironmentReasonCode): RepairGuide {
  return { channel: 'local-terminal', reasonCode, commands: [...(REPAIR_COMMANDS[reasonCode] ?? [])] };
}

function result(
  before: ComponentObservation,
  after: ComponentObservation,
  status: ComponentApplyResult['status'],
  reasonCode?: EnvironmentReasonCode,
  diagnosticSummary?: string,
  changeVerified = true,
): EnvironmentApplyResponse {
  return {
    result: {
      componentId: before.componentId, status, before, after,
      changed: changeVerified && (before.installed !== after.installed || before.installedVersion !== after.installedVersion
        || before.resolvedExecutable !== after.resolvedExecutable),
      ...(reasonCode === undefined ? {} : { reasonCode, repairGuide: repairGuide(reasonCode) }),
      ...(diagnosticSummary === undefined ? {} : { diagnosticSummary: diagnosticSummary.slice(0, 2048) }),
    },
  };
}

function unknownObservation(componentId: EnvironmentComponentId, now: number): ComponentObservation {
  return {
    componentId, platform: process.platform, architecture: process.arch, support: 'unsupported',
    installed: false, installedVersion: null, resolvedExecutable: null,
    packageManager: { kind: 'homebrew', available: false, stableVersion: null },
    authentication: { provider: 'github.com', status: 'unknown' },
    inspectedAt: now, reasonCode: 'unexpected-error',
  };
}

function approvalKey(desired: DesiredComponentState, plan: ComponentPlan): string {
  return JSON.stringify([desired, plan]);
}

function sameDecision(current: ComponentPlan, approved: ComponentPlan): boolean {
  return current.planFingerprint === approved.planFingerprint && current.componentId === approved.componentId
    && current.action === approved.action && current.fromVersion === approved.fromVersion
    && current.targetVersion === approved.targetVersion && current.reasonCode === approved.reasonCode;
}

function verifiedApplyResult(
  before: ComponentObservation,
  after: ComponentObservation,
  plan: ComponentPlan,
  processResult: ProcessResult | null,
): EnvironmentApplyResponse {
  // stdout, stderr, and exception text are intentionally never part of a wire response.
  if (processResult === null || processResult.timedOut || processResult.exitCode !== 0) {
    return result(before, after, 'failed', 'install-failed',
      processResult?.timedOut ? 'Package operation timed out.' : 'Package operation failed.');
  }
  if (!after.installed || after.support !== 'supported' || plan.targetVersion === null
    || after.installedVersion !== plan.targetVersion || after.reasonCode === 'version-source-mismatch') {
    return result(before, after, 'failed', 'verification-failed', 'Installed component did not verify against the approved target.');
  }
  return result(before, after, 'succeeded');
}

export function createEnvironmentService(
  adapters: readonly EnvironmentComponentAdapter[],
  now: () => number = Date.now,
): EnvironmentService {
  const registry = new Map<EnvironmentComponentId, EnvironmentComponentAdapter>();
  const inFlight = new Set<EnvironmentComponentId>();
  const lastObservations = new Map<EnvironmentComponentId, ComponentObservation>();
  // Local issuance is ephemeral: daemon restart/eviction requires another preview.
  const issuedPlans = new Map<string, { issuedAt: number; expiresAt: number }>();
  for (const adapter of adapters) {
    if (!EnvironmentComponentIdSchema.safeParse(adapter.id).success || registry.has(adapter.id)) {
      throw new Error('Invalid or duplicate environment component registration');
    }
    registry.set(adapter.id, adapter);
  }

  function requireAdapter(id: EnvironmentComponentId): EnvironmentComponentAdapter {
    const adapter = registry.get(id);
    if (adapter === undefined) throw new Error('Environment component is not registered');
    return adapter;
  }

  function prunePlans(time: number): void {
    for (const [key, issued] of issuedPlans) {
      if (issued.expiresAt < time) issuedPlans.delete(key);
    }
  }

  async function observe(adapter: EnvironmentComponentAdapter): Promise<ComponentObservation> {
    const parsed = ComponentObservationSchema.safeParse(await adapter.inspect());
    if (!parsed.success || parsed.data.componentId !== adapter.id) throw new Error('Invalid component observation');
    lastObservations.set(adapter.id, parsed.data);
    return parsed.data;
  }

  function planFor(adapter: EnvironmentComponentAdapter, desired: DesiredComponentState, before: ComponentObservation, time: number): ComponentPlan {
    let planned: ComponentPlan;
    try { planned = adapter.plan(desired, before, time); }
    catch { throw new Error('Component planning failed'); }
    const parsed = ComponentPlanSchema.safeParse(planned);
    if (!parsed.success || parsed.data.componentId !== adapter.id || parsed.data.targetVersion !== desired.targetVersion) {
      throw new Error('Invalid component plan');
    }
    return parsed.data;
  }

  return {
    async inspect(input): Promise<EnvironmentInspectResponse> {
      const parsed = EnvironmentInspectRequestSchema.safeParse(input);
      if (!parsed.success) throw new Error('Invalid environment inspect request');
      const request = parsed.data;
      const selected = request.componentIds.map(requireAdapter);
      if (request.desired !== undefined && !request.componentIds.includes(request.desired.componentId)) {
        throw new Error('Desired component must be selected for inspection');
      }
      const observations: ComponentObservation[] = [];
      const plans: ComponentPlan[] = [];
      prunePlans(now());
      for (const adapter of selected) {
        let observed: ComponentObservation;
        try { observed = await observe(adapter); }
        catch { observed = unknownObservation(adapter.id, now()); }
        observations.push(observed);
        if (request.desired !== undefined) {
          const time = now();
          const plan = planFor(adapter, request.desired, observed, time);
          plans.push(plan);
          const key = approvalKey(request.desired, plan);
          if (!issuedPlans.has(key)) issuedPlans.set(key, { issuedAt: time, expiresAt: plan.expiresAt });
          while (issuedPlans.size > MAX_ISSUED_PLANS) issuedPlans.delete(issuedPlans.keys().next().value!);
        }
      }
      return { observations, ...(request.desired === undefined ? {} : { plans }) };
    },

    async apply(input): Promise<EnvironmentApplyResponse> {
      // Parsing copies all request fields before the first await, preventing in-process TOCTOU edits.
      const parsed = EnvironmentApplyRequestSchema.safeParse(input);
      if (!parsed.success) throw new Error('Invalid environment apply request');
      const request = parsed.data;
      const adapter = requireAdapter(request.desired.componentId);
      if (inFlight.has(adapter.id)) {
        const observation = lastObservations.get(adapter.id) ?? unknownObservation(adapter.id, now());
        return result(observation, observation, 'failed', 'operation-in-progress');
      }
      inFlight.add(adapter.id);
      let before = lastObservations.get(adapter.id) ?? unknownObservation(adapter.id, now());
      try {
        before = await observe(adapter);
        const currentPlan = planFor(adapter, request.desired, before, now());
        const time = now();
        prunePlans(time);
        const issued = issuedPlans.get(approvalKey(request.desired, request.plan));
        if (request.plan.expiresAt < time || currentPlan.expiresAt < time || issued === undefined
          || request.approvedAt < issued.issuedAt || request.approvedAt > time
          || request.approvedAt > issued.expiresAt || !sameDecision(currentPlan, request.plan)) {
          return result(before, before, 'stale-plan', 'plan-stale');
        }
        if (currentPlan.action === 'manual-repair') {
          return result(before, before, 'manual-repair', currentPlan.reasonCode ?? 'unexpected-error');
        }
        let processResult: ProcessResult | null;
        try { processResult = await adapter.apply(currentPlan); }
        catch { processResult = null; }
        let after: ComponentObservation;
        try { after = await observe(adapter); }
        catch {
          return result(before, unknownObservation(adapter.id, now()), 'failed', 'verification-failed',
            'Post-operation inspection was unavailable; whether the component changed is unknown. Inspect again.', false);
        }
        return verifiedApplyResult(before, after, currentPlan, processResult);
      } catch {
        return result(before, before, 'failed', 'unexpected-error', 'Component inspection or planning failed.');
      } finally {
        inFlight.delete(adapter.id);
      }
    },
  };
}
