import { z } from 'zod';

export const PersonalComputerStateSchema = z.object({
    available: z.boolean(),
    phase: z.enum(['stopped', 'starting', 'ready', 'error']),
    control: z.enum(['agent', 'human']),
    controllerId: z.string().min(1).max(128).optional(),
    epoch: z.number().int().nonnegative(),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    url: z.string().max(4096).optional(),
    title: z.string().max(500).optional(),
    error: z.string().max(500).optional(),
}).strict();
export type PersonalComputerState = z.infer<typeof PersonalComputerStateSchema>;

// Images are transient, encrypted and never part of transcript or agent state.
export const PersonalComputerFrameSchema = z.object({
    type: z.literal('personal-computer-frame'),
    viewerId: z.string().min(1).max(128),
    sequence: z.number().int().nonnegative(),
    epoch: z.number().int().nonnegative(),
    data: z.string().min(1).max(512 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
}).strict();
export type PersonalComputerFrame = z.infer<typeof PersonalComputerFrameSchema>;

export const PersonalComputerInputSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('click'), x: z.number().min(0).max(4096), y: z.number().min(0).max(4096) }).strict(),
    z.object({ kind: z.literal('scroll'), x: z.number().min(0).max(4096), y: z.number().min(0).max(4096), deltaY: z.number().min(-2000).max(2000) }).strict(),
    z.object({ kind: z.literal('text'), text: z.string().min(1).max(12000) }).strict(),
    z.object({ kind: z.literal('key'), key: z.enum(['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'SelectAll']) }).strict(),
    z.object({ kind: z.literal('navigate'), url: z.string().url().max(4096) }).strict(),
    z.object({ kind: z.literal('element'), action: z.enum(['click', 'fill', 'type', 'hover', 'select', 'press']), ref: z.string().regex(/^@?e[0-9]+$/), value: z.string().max(12000).optional() }).strict(),
]);
export type PersonalComputerInput = z.infer<typeof PersonalComputerInputSchema>;

export const PersonalComputerRequestSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('status') }).strict(),
    z.object({ action: z.literal('start') }).strict(),
    z.object({ action: z.literal('stop'), epoch: z.number().int().nonnegative() }).strict(),
    z.object({ action: z.literal('view'), viewerId: z.string().min(1).max(128) }).strict(),
    z.object({ action: z.literal('unview'), viewerId: z.string().min(1).max(128) }).strict(),
    z.object({ action: z.literal('takeover'), viewerId: z.string().min(1).max(128) }).strict(),
    z.object({ action: z.literal('release'), viewerId: z.string().min(1).max(128), epoch: z.number().int().nonnegative() }).strict(),
    z.object({ action: z.literal('input'), viewerId: z.string().min(1).max(128), epoch: z.number().int().nonnegative(), input: PersonalComputerInputSchema }).strict(),
]);
export type PersonalComputerRequest = z.infer<typeof PersonalComputerRequestSchema>;
export const PersonalComputerResponseSchema = z.object({
    state: PersonalComputerStateSchema,
    frame: PersonalComputerFrameSchema.optional(),
}).strict();
export type PersonalComputerResponse = z.infer<typeof PersonalComputerResponseSchema>;
