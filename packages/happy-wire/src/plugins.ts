import * as z from 'zod';

const PluginIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const PluginVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(50);
const PluginFieldKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/).max(100);

export const PluginLocalizedTextSchema = z.object({
  default: z.string().min(1).max(2_000),
  translations: z.record(z.string().min(2).max(20), z.string().min(1).max(2_000)).optional(),
}).strict();

export const PluginConfigurationFieldSchema = z.object({
  key: PluginFieldKeySchema,
  type: z.enum(['text', 'url', 'secret']),
  required: z.boolean(),
  label: PluginLocalizedTextSchema,
  placeholder: PluginLocalizedTextSchema.optional(),
}).strict();

export const PluginManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: PluginIdSchema,
  version: PluginVersionSchema,
  title: PluginLocalizedTextSchema,
  description: PluginLocalizedTextSchema,
  icon: z.string().regex(/^[A-Za-z0-9-]+$/).max(100),
  featured: z.boolean(),
  installedAction: z.enum(['configure', 'open']),
  entrypoint: z.object({
    type: z.literal('app-route'),
    routeId: PluginIdSchema,
  }).strict(),
  configuration: z.object({
    notice: PluginLocalizedTextSchema.optional(),
    fields: z.array(PluginConfigurationFieldSchema).max(20),
  }).strict(),
}).strict();

export const PluginInstallationStatusSchema = z.discriminatedUnion('installed', [
  z.object({ installed: z.literal(false) }).strict(),
  z.object({
    installed: z.literal(true),
    version: PluginVersionSchema,
    configuration: z.record(PluginFieldKeySchema, z.string().max(2_000)),
    secretHints: z.record(PluginFieldKeySchema, z.string().max(100)),
  }).strict(),
]);

export const PluginCatalogItemSchema = z.object({
  manifest: PluginManifestSchema,
  status: PluginInstallationStatusSchema,
}).strict();

export const PluginCatalogResponseSchema = z.object({
  plugins: z.array(PluginCatalogItemSchema),
}).strict();

export const PluginInstallRequestSchema = z.object({
  version: PluginVersionSchema,
  configuration: z.record(PluginFieldKeySchema, z.string().max(4_000)),
}).strict();

export type PluginLocalizedText = z.infer<typeof PluginLocalizedTextSchema>;
export type PluginConfigurationField = z.infer<typeof PluginConfigurationFieldSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginInstallationStatus = z.infer<typeof PluginInstallationStatusSchema>;
export type PluginCatalogItem = z.infer<typeof PluginCatalogItemSchema>;
export type PluginCatalogResponse = z.infer<typeof PluginCatalogResponseSchema>;
export type PluginInstallRequest = z.infer<typeof PluginInstallRequestSchema>;
