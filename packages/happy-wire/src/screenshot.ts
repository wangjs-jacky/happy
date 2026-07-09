import { z } from 'zod';

export const ScreenshotTargetSchema = z.enum(['desktop', 'browser']);
export type ScreenshotTarget = z.infer<typeof ScreenshotTargetSchema>;

export const ScreenshotRequestSchema = z.object({
  type: z.literal('screenshot'),
  target: ScreenshotTargetSchema,
  timestamp: z.number(),
});
export type ScreenshotRequest = z.infer<typeof ScreenshotRequestSchema>;

export const ScreenshotResponseSchema = z.object({
  data: z.string(),
  mimeType: z.enum(['image/png', 'image/jpeg']),
  size: z.number(),
  timestamp: z.number(),
  targetUsed: ScreenshotTargetSchema,
});
export type ScreenshotResponse = z.infer<typeof ScreenshotResponseSchema>;
