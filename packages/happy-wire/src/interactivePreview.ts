import * as z from 'zod';

export const PREVIEW_LIMITS = {
  maxFiles: 100,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
} as const;

// Fastify's route-parameter limit is 100 bytes by default. Leave room for
// its path parser while keeping the opaque asset identifier comfortably large.
export const PREVIEW_ASSET_ID_MAX_LENGTH = 96;
export const interactivePreviewAssetIdSchema = z.string().min(1).max(PREVIEW_ASSET_ID_MAX_LENGTH).regex(/^[A-Za-z0-9_-]+$/);

const allowedMimeTypesByExtension: Readonly<Record<string, readonly string[]>> = {
  '.html': ['text/html'],
  '.css': ['text/css'],
  '.js': ['application/javascript', 'text/javascript'],
  '.mjs': ['application/javascript', 'text/javascript'],
  '.json': ['application/json'],
  '.txt': ['text/plain'],
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.svg': ['image/svg+xml'],
  '.ico': ['image/x-icon', 'image/vnd.microsoft.icon'],
  '.woff': ['font/woff'],
  '.woff2': ['font/woff2'],
};

function extensionOf(path: string): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || new TextEncoder().encode(path).byteLength > 240) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.startsWith('.')
    && !/[\u0000-\u001f\u007f]/u.test(segment));
}

export const interactivePreviewAssetSchema = z.object({
  id: interactivePreviewAssetIdSchema,
  path: z.string().min(1).max(240).refine(isSafeRelativePath, 'Unsafe preview path'),
  size: z.number().int().nonnegative().max(PREVIEW_LIMITS.maxFileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().min(1).max(128),
}).strict().superRefine((asset, ctx) => {
  const allowed = allowedMimeTypesByExtension[extensionOf(asset.path)];
  if (!allowed?.includes(asset.mimeType)) {
    ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'Unsupported preview file type' });
  }
});

export const interactivePreviewManifestSchema = z.object({
  version: z.literal(1),
  previewId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  assets: z.array(interactivePreviewAssetSchema).min(1).max(PREVIEW_LIMITS.maxFiles),
}).strict().superRefine((manifest, ctx) => {
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const [index, asset] of manifest.assets.entries()) {
    if (paths.has(asset.path)) {
      ctx.addIssue({ code: 'custom', path: ['assets', index, 'path'], message: 'Duplicate preview path' });
    }
    paths.add(asset.path);
    totalBytes += asset.size;
  }
  if (!paths.has('index.html')) {
    ctx.addIssue({ code: 'custom', path: ['assets'], message: 'Root index.html is required' });
  }
  if (totalBytes > PREVIEW_LIMITS.maxTotalBytes) {
    ctx.addIssue({ code: 'custom', path: ['assets'], message: 'Preview total byte limit exceeded' });
  }
});

export type InteractivePreviewAsset = z.infer<typeof interactivePreviewAssetSchema>;
export type InteractivePreviewManifest = z.infer<typeof interactivePreviewManifestSchema>;

export function validateInteractivePreviewManifest(value: unknown): InteractivePreviewManifest {
  return interactivePreviewManifestSchema.parse(value);
}

export const interactivePreviewStateSchema = z.enum(['publishing', 'ready', 'failed', 'expired']);

export const interactivePreviewEventSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  state: interactivePreviewStateSchema,
  url: z.string().url().optional(),
  publishedAt: z.number().int().nonnegative().optional(),
  expiresAt: z.number().int().nonnegative().optional(),
  errorCode: z.string().min(1).max(64).optional(),
}).strict();

export type InteractivePreviewState = z.infer<typeof interactivePreviewStateSchema>;
export type InteractivePreviewEvent = z.infer<typeof interactivePreviewEventSchema>;
