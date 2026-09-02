import { z } from 'zod';

export const MCP_APP_MAX_BRIDGE_MESSAGE_BYTES = 256 * 1024;
export const MCP_APP_MIN_FRAME_HEIGHT = 120;
export const MCP_APP_MAX_FRAME_HEIGHT = 720;

export const hostContextSchema = z.object({
    theme: z.enum(['light', 'dark']),
    locale: z.string().min(1).max(64),
    platform: z.enum(['web', 'android', 'ios', 'desktop']),
    touch: z.boolean(),
    hover: z.boolean(),
    container: z.object({ width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }).strict(),
    safeAreaInsets: z.object({
        top: z.number().finite().nonnegative(), right: z.number().finite().nonnegative(),
        bottom: z.number().finite().nonnegative(), left: z.number().finite().nonnegative(),
    }).strict(),
    displayMode: z.literal('inline'),
}).strict();

const mcpAppToolResultSchema = z.object({
    content: z.array(z.unknown()),
    structuredContent: z.unknown().optional(),
    _meta: z.unknown().optional(),
    isError: z.boolean().optional(),
}).strict();

export const hostCommandSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('mount'), instanceId: z.string().min(1), html: z.string(), context: hostContextSchema }).strict(),
    z.object({ type: z.literal('tool-input'), instanceId: z.string().min(1), input: z.record(z.string(), z.unknown()) }).strict(),
    z.object({ type: z.literal('tool-result'), instanceId: z.string().min(1), result: mcpAppToolResultSchema }).strict(),
    z.object({ type: z.literal('tool-cancelled'), instanceId: z.string().min(1), reason: z.string().max(280) }).strict(),
    z.object({ type: z.literal('host-context'), instanceId: z.string().min(1), context: hostContextSchema }).strict(),
    z.object({ type: z.literal('teardown'), instanceId: z.string().min(1) }).strict(),
]);

export const nativeMessages = z.discriminatedUnion('type', [
    z.object({ type: z.literal('sandbox-ready'), instanceId: z.string().min(1) }).strict(),
    z.object({ type: z.literal('initialized'), instanceId: z.string().min(1) }).strict(),
    z.object({ type: z.literal('resize'), instanceId: z.string().min(1), height: z.number() }).strict(),
    z.object({ type: z.literal('teardown-complete'), instanceId: z.string().min(1) }).strict(),
    z.object({ type: z.literal('protocol-error'), instanceId: z.string().min(1) }).strict(),
]);

export type HostCommand = z.infer<typeof hostCommandSchema>;
export type NativeMessage = z.infer<typeof nativeMessages>;

export function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

export function parseHostCommand(raw: string): HostCommand {
    if (typeof raw !== 'string' || utf8ByteLength(raw) > MCP_APP_MAX_BRIDGE_MESSAGE_BYTES) {
        throw new Error('Invalid MCP App bridge message.');
    }
    return hostCommandSchema.parse(JSON.parse(raw));
}
