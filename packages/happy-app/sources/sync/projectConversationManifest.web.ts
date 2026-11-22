import { GoalProjectConversationCatalogHeaderSchema, GoalProjectConversationCatalogPageSchema } from '@slopus/happy-wire';
import { TokenStorage } from '@/auth/tokenStorage';
import { fetchSessionSnapshotPage, SessionRequestError } from './apiSessions';
import { projectGoalRequest } from './projectGoals';

type Header = { id: string; metadataVersion: number; metadata: string; dataEncryptionKey: string | null };
type Manifest = { projectPath: string; snapshotId: string; catalogFingerprint: string; total: number; expiresAt: number;
    sessions: Array<{ id: string; metadataVersion: number }> };
const HTTP_BATCH = 25, REPAIR_BATCH = 200, CONCURRENCY = 3, MAX_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();

/** HTTP is only an accelerator: the daemon's immutable identities/versions
 * remain authoritative. Concurrent edits and deletions are filled from that
 * exact snapshot, never silently replaced by a newer or incomplete directory. */
export async function readProjectConversationManifestHeaders(machineId: string, projectPath: string, manifest: Manifest,
    options: { current: () => void; version?: string; signal?: AbortSignal }): Promise<Header[]> {
    const current = () => {
        if (options.signal?.aborted) throw options.signal.reason === undefined ? new Error('Project history read cancelled') : options.signal.reason;
        options.current();
    };
    current();
    if (manifest.projectPath !== projectPath || manifest.sessions.length !== manifest.total
        || new Set(manifest.sessions.map(row => row.id)).size !== manifest.total) throw new Error('Project history manifest is incomplete');
    if (!manifest.total) return [];
    const credentials = await TokenStorage.getCredentials();
    current();
    if (!credentials) throw new Error('Project history authentication is unavailable');
    // /v2/sessions uses an exclusive ID-descending cursor. Deriving finite
    // ranges from the manifest lets us read independent pages concurrently.
    const ordered = [...manifest.sessions].sort((a, b) => a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    const versions = new Map(ordered.map(row => [row.id, row.metadataVersion]));
    const found = new Map<string, Header>();
    let next = 0, bytes = 2, failed = false;
    const http = new AbortController(), stopped = new Error('Project history HTTP acceleration stopped');
    const abortHttp = () => http.abort(stopped);
    const accept = (row: Header) => {
        if (found.has(row.id)) return;
        bytes += encoder.encode(JSON.stringify(row)).byteLength + 1;
        if (bytes > MAX_BYTES) throw new Error('Project history catalog exceeds the size limit');
        found.set(row.id, row);
    };
    const worker = async () => {
        try {
          while (next < ordered.length) {
            current();
            if (failed) return;
            const start = next; next += HTTP_BATCH;
            const page = await fetchSessionSnapshotPage(credentials, { limit: HTTP_BATCH, signal: http.signal,
                ...(start ? { cursor: `cursor_v1_${ordered[start - 1].id}` } : {}) });
            current();
            if (failed) return;
            for (const row of page.sessions) {
                if (versions.get(row.id) !== row.metadataVersion) continue;
                accept(GoalProjectConversationCatalogHeaderSchema.parse(row));
            }
          }
        } catch (error) {
            failed = true;
            if (error === stopped) return;
            try {
                current();
                if (!(error instanceof SessionRequestError && error.retryable)) throw error;
            } finally { abortHttp(); }
        }
    };
    options.signal?.addEventListener('abort', abortHttp, { once: true });
    try {
        // The first failure stops new HTTP work and aborts its siblings. Join
        // them before repair so late bodies cannot mutate found or mask a
        // permanent failure with a cancellation from another worker.
        const results = await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, Math.ceil(ordered.length / HTTP_BATCH)) }, worker));
        for (const result of results) if (result.status === 'rejected') throw result.reason;
    } finally {
        options.signal?.removeEventListener('abort', abortHttp);
        abortHttp();
    }
    current();
    if (manifest.expiresAt <= Date.now()) throw new Error('Project history manifest expired');
    const missing = manifest.sessions.filter(row => !found.has(row.id)).map(row => row.id);
    for (let start = 0; start < missing.length; start += REPAIR_BATCH) {
        const sessionIds = missing.slice(start, start + REPAIR_BATCH), seen = new Set<string>(), cursors = new Set<string>();
        let cursor: string | undefined;
        do {
            current();
            const input = { projectPath, snapshotId: manifest.snapshotId, sessionIds, ...(cursor ? { cursor } : {}) };
            const response = await (options.version
                ? projectGoalRequest(machineId, 'goalProjectConversationCatalog', input, options.version)
                : projectGoalRequest(machineId, 'goalProjectConversationCatalog', input));
            current();
            if (encoder.encode(JSON.stringify(response)).byteLength > 256 * 1024) throw new Error('Project history catalog page exceeds the size limit');
            const page = GoalProjectConversationCatalogPageSchema.parse(response);
            if (page.projectPath !== projectPath || page.snapshotId !== manifest.snapshotId || page.catalogFingerprint !== manifest.catalogFingerprint
                || page.expiresAt !== manifest.expiresAt || page.expiresAt <= Date.now() || page.total !== sessionIds.length)
                throw new Error('Project history snapshot changed during missing-record retrieval');
            for (const row of page.sessions) {
                if (!sessionIds.includes(row.id) || versions.get(row.id) !== row.metadataVersion || seen.has(row.id))
                    throw new Error('Project history snapshot returned an invalid identity or version');
                seen.add(row.id); accept(row);
            }
            if (!page.hasNext) {
                if (page.nextCursor || seen.size !== sessionIds.length) throw new Error('Project history snapshot is incomplete');
                break;
            }
            if (!page.sessions.length || !page.nextCursor || page.nextCursor === cursor || cursors.has(page.nextCursor))
                throw new Error('Project history snapshot cursor did not advance');
            cursors.add(page.nextCursor); cursor = page.nextCursor;
        } while (cursor);
    }
    current();
    if (found.size !== manifest.total) throw new Error('Project history manifest is incomplete');
    return manifest.sessions.map(row => found.get(row.id)!);
}
