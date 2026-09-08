import { z } from 'zod';

export const EnvironmentComponentIdSchema = z.enum([
  'github-cli',
  'paws-cli',
  'ego-browser',
  'cloudflare-wrangler',
  'cloudflared',
]);
export type EnvironmentComponentId = z.infer<typeof EnvironmentComponentIdSchema>;

export const AlignableEnvironmentComponentIdSchema = z.enum(['github-cli', 'paws-cli']);
export type AlignableEnvironmentComponentId = z.infer<typeof AlignableEnvironmentComponentIdSchema>;

export const EnvironmentSourceSchema = z.object({
  kind: z.enum(['homebrew', 'npm-global', 'app-managed', 'none']),
  available: z.boolean(),
  latestVersion: z.string().max(128).nullable(),
  ownership: z.enum(['verified', 'unverified', 'not-applicable']),
}).strict();
export type EnvironmentSource = z.infer<typeof EnvironmentSourceSchema>;

const AuthenticationDisplayValueSchema = z.string().min(1).max(256).refine(
  (value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && !/^[a-f0-9]{32}$/iu.test(value),
  'must not contain an email address or Cloudflare account ID',
);

export const EnvironmentAuthenticationSchema = z.object({
  provider: z.enum(['github.com', 'cloudflare']),
  status: z.enum(['authenticated', 'missing', 'unknown']),
  principal: AuthenticationDisplayValueSchema.optional(),
  accountLabels: z.array(AuthenticationDisplayValueSchema).max(8).optional(),
}).strict();
export type EnvironmentAuthentication = z.infer<typeof EnvironmentAuthenticationSchema>;

const GithubCliDetailsSchema = z.object({ kind: z.literal('github-cli') }).strict();
const PawsCliDetailsSchema = z.object({ kind: z.literal('paws-cli') }).strict();
const EgoBrowserDetailsSchema = z.object({
  kind: z.literal('ego-browser'),
  appVersion: z.string().max(128).nullable(),
  chromiumVersion: z.string().max(128).nullable(),
  nodeVersion: z.string().max(128).nullable(),
  pathReady: z.boolean(),
  paired: z.boolean(),
}).strict();
const CloudflareWranglerDetailsSchema = z.object({ kind: z.literal('cloudflare-wrangler') }).strict();
const CloudflaredDetailsSchema = z.object({ kind: z.literal('cloudflared'), tunnelCertificatePresent: z.boolean() }).strict();

export const EnvironmentDetailsSchema = z.discriminatedUnion('kind', [
  GithubCliDetailsSchema,
  PawsCliDetailsSchema,
  EgoBrowserDetailsSchema,
  CloudflareWranglerDetailsSchema,
  CloudflaredDetailsSchema,
]);
export type EnvironmentDetails = z.infer<typeof EnvironmentDetailsSchema>;

export const EnvironmentReasonCodeSchema = z.enum([
  'machine-offline', 'unsupported-platform', 'unsupported-architecture',
  'homebrew-missing', 'formula-unavailable', 'version-source-mismatch',
  'version-ahead', 'authentication-missing', 'operation-in-progress',
  'plan-stale', 'install-failed', 'verification-failed', 'process-timeout', 'rpc-timeout',
  'unexpected-error',
]);
export type EnvironmentReasonCode = z.infer<typeof EnvironmentReasonCodeSchema>;

const REPAIR_COMMANDS: Partial<Record<EnvironmentComponentId, Partial<Record<EnvironmentReasonCode, readonly string[]>>>> = {
  'github-cli': {
    'homebrew-missing': ['command -v brew'],
    'formula-unavailable': ['brew info gh'],
    'version-source-mismatch': ['command -v gh', 'gh --version', 'brew info gh'],
    'version-ahead': ['gh --version', 'brew info gh'],
    'authentication-missing': ['gh auth login --hostname github.com'],
    'install-failed': ['brew doctor', 'brew info gh'],
    'verification-failed': ['gh --version', 'brew info gh'],
    'unexpected-error': ['gh --version', 'brew info gh'],
  },
  'paws-cli': {
    'version-source-mismatch': ['paws --version', 'command -v paws', 'npm prefix -g'],
    'version-ahead': ['paws --version', 'npm prefix -g'],
    'install-failed': ['paws --version', 'command -v paws', 'npm prefix -g'],
    'verification-failed': ['paws --version', 'command -v paws', 'npm prefix -g'],
    'unexpected-error': ['paws --version', 'command -v paws', 'npm prefix -g'],
  },
  'ego-browser': {
    'version-source-mismatch': ['ego-browser --version', 'command -v ego-browser'],
    'unexpected-error': ['ego-browser --version', 'command -v ego-browser'],
  },
  'cloudflare-wrangler': {
    'authentication-missing': ['wrangler login'],
    'unexpected-error': ['wrangler --version', 'command -v wrangler'],
  },
  cloudflared: {
    'homebrew-missing': ['command -v brew'],
    'formula-unavailable': ['brew info cloudflared'],
    'version-source-mismatch': ['cloudflared --version', 'brew info cloudflared'],
    'unexpected-error': ['cloudflared --version', 'command -v cloudflared'],
  },
};

/** Static local guidance only; command output and caller input never become commands. */
export function environmentRepairCommands(componentId: EnvironmentComponentId, reasonCode?: EnvironmentReasonCode): string[] {
  return [...(reasonCode === undefined ? [] : REPAIR_COMMANDS[componentId]?.[reasonCode] ?? [])];
}

export const DesiredComponentStateSchema = z.object({
  componentId: AlignableEnvironmentComponentIdSchema,
  targetVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u),
}).strict();

const ComponentObservationBaseSchema = z.object({
  platform: z.string().min(1).max(64),
  architecture: z.string().min(1).max(64),
  support: z.enum(['supported', 'unsupported']),
  installed: z.boolean(),
  installedVersion: z.string().max(128).nullable(),
  resolvedExecutable: z.string().max(4096).nullable(),
  source: EnvironmentSourceSchema,
  authentication: EnvironmentAuthenticationSchema.optional(),
  inspectedAt: z.number().int().nonnegative(),
  reasonCode: EnvironmentReasonCodeSchema.optional(),
});

export const ComponentObservationSchema = z.discriminatedUnion('componentId', [
  ComponentObservationBaseSchema.extend({
    componentId: z.literal('github-cli'), capability: z.literal('alignable'), details: GithubCliDetailsSchema,
  }).strict(),
  ComponentObservationBaseSchema.extend({
    componentId: z.literal('paws-cli'), capability: z.enum(['alignable', 'inspect-only']), details: PawsCliDetailsSchema,
  }).strict(),
  ComponentObservationBaseSchema.extend({
    componentId: z.literal('ego-browser'), capability: z.literal('inspect-only'), details: EgoBrowserDetailsSchema,
  }).strict(),
  ComponentObservationBaseSchema.extend({
    componentId: z.literal('cloudflare-wrangler'), capability: z.literal('inspect-only'), details: CloudflareWranglerDetailsSchema,
  }).strict(),
  ComponentObservationBaseSchema.extend({
    componentId: z.literal('cloudflared'), capability: z.literal('inspect-only'), details: CloudflaredDetailsSchema,
  }).strict(),
]);

export const ComponentPlanSchema = z.object({
  componentId: AlignableEnvironmentComponentIdSchema,
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
  componentIds: z.array(EnvironmentComponentIdSchema).min(1).max(5).superRefine((componentIds, context) => {
    if (new Set(componentIds).size !== componentIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'componentIds must be unique' });
    }
  }),
  desired: DesiredComponentStateSchema.optional(),
}).strict();

export const EnvironmentInspectResponseSchema = z.object({
  observations: z.array(ComponentObservationSchema).max(5),
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
