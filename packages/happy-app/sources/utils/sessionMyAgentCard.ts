import { z } from 'zod';
export const MyAgentCardSchema = z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    name: z.string().min(1).max(40),
    summary: z.string().max(240).default(''),
});
export type MyAgentCard = z.infer<typeof MyAgentCardSchema>;
export function parseMyAgentCard(value: string): MyAgentCard | null {
    try {
        const parsed = MyAgentCardSchema.safeParse(JSON.parse(value));
        return parsed.success ? parsed.data : null;
    } catch { return null; }
}
