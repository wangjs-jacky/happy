import { z } from 'zod';

export const EnvironmentComponentIdSchema = z.enum(['github-cli']);
export type EnvironmentComponentId = z.infer<typeof EnvironmentComponentIdSchema>;

export const EnvironmentReasonCodeSchema = z.enum([
  'machine-offline', 'unsupported-platform', 'unsupported-architecture',
  'homebrew-missing', 'formula-unavailable', 'version-source-mismatch',
  'version-ahead', 'authentication-missing', 'operation-in-progress',
  'plan-stale', 'install-failed', 'verification-failed', 'process-timeout', 'rpc-timeout',
  'unexpected-error',
]);
export type EnvironmentReasonCode = z.infer<typeof EnvironmentReasonCodeSchema>;

export const DesiredComponentStateSchema = z.object({
  componentId: EnvironmentComponentIdSchema,
  targetVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u),
}).strict();

export const ComponentObservationSchema = z.object({
  componentId: EnvironmentComponentIdSchema,
  platform: z.string().min(1).max(64),
  architecture: z.string().min(1).max(64),
  support: z.enum(['supported', 'unsupported']),
  installed: z.boolean(),
  installedVersion: z.string().nullable(),
  resolvedExecutable: z.string().max(4096).nullable(),
  packageManager: z.object({
    kind: z.literal('homebrew'),
    available: z.boolean(),
    stableVersion: z.string().nullable(),
  }).strict(),
  authentication: z.object({
    provider: z.literal('github.com'),
    status: z.enum(['authenticated', 'missing', 'unknown']),
  }).strict(),
  inspectedAt: z.number().int().nonnegative(),
  reasonCode: EnvironmentReasonCodeSchema.optional(),
}).strict();

export const ComponentPlanSchema = z.object({
  componentId: EnvironmentComponentIdSchema,
  action: z.enum(['none', 'install', 'upgrade', 'manual-repair']),
  fromVersion: z.string().nullable(),
  targetVersion: z.string().nullable(),
  planFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAt: z.number().int().positive(),
  reasonCode: EnvironmentReasonCodeSchema.optional(),
}).strict();

export const RepairGuideSchema = z.object({
  channel: z.enum(['ssh', 'local-terminal']),
  reasonCode: EnvironmentReasonCodeSchema,
  commands: z.array(z.string().min(1).max(512)).max(3),
}).strict();

export const ComponentApplyResultSchema = z.object({
  componentId: EnvironmentComponentIdSchema,
  status: z.enum(['succeeded', 'failed', 'stale-plan', 'manual-repair']),
  before: ComponentObservationSchema,
  after: ComponentObservationSchema,
  changed: z.boolean(),
  reasonCode: EnvironmentReasonCodeSchema.optional(),
  repairGuide: RepairGuideSchema.optional(),
  diagnosticSummary: z.string().max(2048).optional(),
}).strict();

export const EnvironmentInspectRequestSchema = z.object({
  componentIds: z.array(EnvironmentComponentIdSchema).min(1).max(1),
  desired: DesiredComponentStateSchema.optional(),
}).strict();

export const EnvironmentInspectResponseSchema = z.object({
  observations: z.array(ComponentObservationSchema).max(1),
  plans: z.array(ComponentPlanSchema).max(1).optional(),
}).strict();

export const EnvironmentApplyRequestSchema = z.object({
  desired: DesiredComponentStateSchema,
  plan: ComponentPlanSchema,
  approvedAt: z.number().int().nonnegative(),
}).strict();

export const EnvironmentApplyResponseSchema = z.object({
  result: ComponentApplyResultSchema,
}).strict();

export type DesiredComponentState = z.infer<typeof DesiredComponentStateSchema>;
export type ComponentObservation = z.infer<typeof ComponentObservationSchema>;
export type ComponentPlan = z.infer<typeof ComponentPlanSchema>;
export type RepairGuide = z.infer<typeof RepairGuideSchema>;
export type ComponentApplyResult = z.infer<typeof ComponentApplyResultSchema>;
export type EnvironmentInspectRequest = z.infer<typeof EnvironmentInspectRequestSchema>;
export type EnvironmentInspectResponse = z.infer<typeof EnvironmentInspectResponseSchema>;
export type EnvironmentApplyRequest = z.infer<typeof EnvironmentApplyRequestSchema>;
export type EnvironmentApplyResponse = z.infer<typeof EnvironmentApplyResponseSchema>;
