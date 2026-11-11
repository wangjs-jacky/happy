import type { ApiMessage } from './apiTypes';
import type { NormalizedMessage } from './typesRaw';

type Entry = {
    seq: number;
    createdAt: number;
    updatedAt: number;
    localId: string | null | undefined;
    ciphertext: string;
    value: NormalizedMessage | null;
    bytes: number;
};

/** Approximate retained JS data, including normalized tool payloads. Stop once
 * over budget instead of serializing a potentially huge payload just to size it. */
function estimatedBytes(value: unknown, budget: number): number {
    const seen = new Set<object>();
    let total = 0;
    const visit = (item: unknown): void => {
        if (total > budget || item == null) return;
        if (typeof item === 'string') { total += 16 + item.length * 2; return; }
        if (typeof item !== 'object') { total += 8; return; }
        if (seen.has(item)) return;
        seen.add(item);
        total += 32;
        for (const key of Object.keys(item)) {
            total += 16 + key.length * 2;
            visit((item as Record<string, unknown>)[key]);
            if (total > budget) break;
        }
    };
    visit(value);
    return total;
}

/** A bounded, memory-only cache owned by one session/encryption generation.
 * Values are shared immutable inputs to the reducer, never its mutable state.
 * The owner must discard this cache when account, session or encryption changes. */
export class HistoryProjectionCache {
    private readonly entries = new Map<string, Entry>();
    private bytes = 0;

    constructor(private readonly maxEntries = 500, private readonly maxBytes = 8 * 1024 * 1024) {}

    /** undefined is a miss; null is a successfully normalized invisible record. */
    get(message: ApiMessage): NormalizedMessage | null | undefined {
        const entry = this.entries.get(message.id);
        if (!entry) return undefined;
        if (entry.seq !== message.seq || entry.createdAt !== message.createdAt
            || entry.updatedAt !== message.updatedAt || entry.localId !== message.localId
            || entry.ciphertext !== message.content.c) {
            this.remove(message.id);
            return undefined;
        }
        this.entries.delete(message.id);
        this.entries.set(message.id, entry);
        return entry.value;
    }

    set(message: ApiMessage, value: NormalizedMessage | null): void {
        this.remove(message.id);
        if (this.maxEntries <= 0 || this.maxBytes <= 0) return;
        const bytes = 128 + 2 * (message.id.length + (message.localId?.length ?? 0) + message.content.c.length)
            + estimatedBytes(value, this.maxBytes);
        if (bytes > this.maxBytes) return;
        while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.remove(oldest);
        }
        // Snapshot identity fields rather than retaining the mutable wire object.
        this.entries.set(message.id, {
            seq: message.seq, createdAt: message.createdAt, updatedAt: message.updatedAt,
            localId: message.localId, ciphertext: message.content.c, value, bytes,
        });
        this.bytes += bytes;
    }

    retain(ids: ReadonlySet<string>): void {
        for (const id of this.entries.keys()) if (!ids.has(id)) this.remove(id);
    }

    clear(): void { this.entries.clear(); this.bytes = 0; }

    private remove(id: string): void {
        const entry = this.entries.get(id);
        if (entry) { this.bytes -= entry.bytes; this.entries.delete(id); }
    }
}
