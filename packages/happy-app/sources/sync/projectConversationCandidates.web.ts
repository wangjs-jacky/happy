import { GoalProjectConversationCatalogManifestPageSchema, GoalProjectConversationCatalogPageSchema, type GoalProjectConversationCandidate } from '@slopus/happy-wire';
import { assertAccountRuntime, getRuntimeAccountSelection } from '@/auth/accountRuntime';
import { projectGoalRequest } from './projectGoals';
import { sync } from './sync';
import { readProjectConversationManifestHeaders, type ResolvedCatalogHeader, type ClassifiedCatalogHeader } from './projectConversationManifest.web';

type Candidates = { candidates: GoalProjectConversationCandidate[]; catalogFingerprint: string; catalogSnapshotId: string };
export type ProjectConversationHistoryProgress = { phase: 'catalog' | 'grouping'; processed: number; total: number };
type CatalogCache = {
    account: ReturnType<typeof getRuntimeAccountSelection>;
    encryption: typeof sync.encryption;
    machineId: string;
    projectPath: string;
    expiresAt: number;
    total: number;
    complete: boolean;
    pending: Promise<Candidates>;
};
let catalogs: CatalogCache[] = [];
let readVersion = 0;
const encoder = new TextEncoder();

/** The daemon pins complete identities/versions and reuses explicit compact
 * classifications. The Web decrypts only opaque records and commits bounded
 * classification proofs; owner keys and foreign plaintext stay in this client. */
export function loadProjectConversationCandidates(
    machineId: string,
    projectPath: string,
    options: { refresh?: boolean; signal?: AbortSignal; onProgress?: (progress: ProjectConversationHistoryProgress) => void } = {},
): Promise<Candidates> {
    assertAccountRuntime();
    const signal = options.signal;
    const cancellation = () => signal?.reason === undefined
        ? new DOMException('Project history read cancelled', 'AbortError') : signal.reason;
    if (signal?.aborted) return Promise.reject(cancellation());
    const account = getRuntimeAccountSelection(), encryption = sync.encryption;
    const current = () => {
        if (signal?.aborted) throw cancellation();
        assertAccountRuntime();
        if (getRuntimeAccountSelection() !== account || sync.encryption !== encryption) throw new Error('Project history account changed');
    };
    const progress = (processed: number, total: number) => {
        current();
        options.onProgress?.({ phase: 'catalog', processed, total });
        current();
    };
    catalogs = catalogs.filter(entry => entry.account === account && entry.encryption === encryption && entry.expiresAt > Date.now() + 5_000);
    const existing = catalogs.find(entry => entry.machineId === machineId && entry.projectPath === projectPath);
    if (existing && !options.refresh && (!signal || existing.complete)) {
        return existing.pending.then(result => {
            progress(existing.total, existing.total);
            return result;
        });
    }
    catalogs = catalogs.filter(entry => entry !== existing);
    const entry: CatalogCache = { account, encryption, machineId, projectPath, expiresAt: Infinity, total: 0, complete: false, pending: undefined! };
    catalogs.push(entry);
    if (catalogs.length > 2) catalogs.shift();
    const evict = () => { catalogs = catalogs.filter(candidate => candidate !== entry); };
    let detach = () => {};
    const cancelled = signal ? new Promise<never>((_resolve, reject) => {
        const abort = () => { evict(); detach(); reject(cancellation()); };
        detach = () => signal.removeEventListener('abort', abort);
        signal.addEventListener('abort', abort, { once: true });
    }) : undefined;
    // A cancelled RPC may remain pending in the transport's shared-read map.
    // Each cancellable traversal owns a distinct request identity for its pages.
    const version = signal ? `project-conversation-catalog-${++readVersion}` : undefined;
    const read = (async () => {
        if (!encryption) throw new Error('Project history encryption is unavailable');
        progress(0, 0);
        const candidates: GoalProjectConversationCandidate[] = [], versions = new Map<string, number>(), cursors = new Set<string>();
        let snapshot: { snapshotId: string; catalogFingerprint: string; total: number; expiresAt: number } | undefined;
        let cursor: string | undefined, catalogBytes = 0, candidateBytes = 2, indexSupported = false;
        const indexEntries: ClassifiedCatalogHeader[] = [];
        const append = (candidate: GoalProjectConversationCandidate) => {
            candidateBytes += encoder.encode(JSON.stringify(candidate)).byteLength + 1;
            if (candidateBytes > 512 * 1024) throw new Error('Complete project history exceeds the request size limit');
            candidates.push(candidate);
        };
        const consumeRows = async (rows: ResolvedCatalogHeader[], total: number, publish: boolean) => {
            for (let index = 0; index < rows.length; index++) {
                current(); const row = rows[index];
                if (versions.has(row.id)) throw new Error('Project history catalog contains duplicate identities');
                versions.set(row.id, row.metadataVersion);
                if (versions.size > 20_000 || versions.size > total) throw new Error('Project history catalog total is invalid');
                catalogBytes += encoder.encode(JSON.stringify(row)).byteLength;
                if (catalogBytes > 64 * 1024 * 1024) throw new Error('Project history catalog exceeds the size limit');
                if ('candidate' in row) {
                    if (row.candidate !== null) append(row.candidate);
                } else {
                    const key = row.dataEncryptionKey ? await encryption.decryptEncryptionKey(row.dataEncryptionKey) : null;
                    current();
                    if (row.dataEncryptionKey && !key) throw new Error('Project history record key could not be decrypted');
                    const prepared = await encryption.prepareSessionEncryption(row.id, key); current();
                    const metadata = await prepared.sessionEncryption.decryptMetadata(row.metadataVersion, row.metadata); current();
                    if (!metadata) throw new Error('Project history metadata could not be decrypted');
                    let candidate: GoalProjectConversationCandidate | null = null;
                    if (metadata.machineId === machineId) {
                        if (typeof metadata.path !== 'string' || !metadata.path) throw new Error('Project history metadata has no directory');
                        candidate = { sessionId: row.id, metadataVersion: row.metadataVersion, directory: metadata.path,
                            title: (metadata.name || metadata.summary?.text || '').slice(0, 2048),
                            ...(metadata.goalBoard?.featurePath ? { featurePath: metadata.goalBoard.featurePath } : {}),
                            ...(metadata.goalBoard?.taskId ? { taskId: metadata.goalBoard.taskId } : {}),
                            ...(metadata.lifecycleState ? { lifecycleState: metadata.lifecycleState } : {}) };
                        append(candidate);
                    }
                    indexEntries.push({ id: row.id, metadataVersion: row.metadataVersion, candidate });
                }
                if (index % 32 === 31) {
                    if (publish) progress(versions.size, total);
                    await new Promise<void>(resolve => setTimeout(resolve, 0));
                }
            }
        };
        do {
            current();
            const input = {
                projectPath, ...(snapshot ? { snapshotId: snapshot.snapshotId, cursor } : { format: 'manifest' }),
            };
            let response: unknown = await (version
                ? projectGoalRequest(machineId, 'goalProjectConversationCatalog', input, version)
                : projectGoalRequest(machineId, 'goalProjectConversationCatalog', input));
            current();
            if (encoder.encode(JSON.stringify(response)).byteLength > 256 * 1024) throw new Error('Project history catalog page exceeds the size limit');
            const format = response && typeof response === 'object' && 'format' in response ? response.format : undefined;
            const manifestResponse = format === 'manifest';
            if (format !== undefined && !manifestResponse) throw new Error('Project history catalog format is invalid');
            if (manifestResponse) {
                if (snapshot) throw new Error('Project history catalog format changed between pages');
                const first = GoalProjectConversationCatalogManifestPageSchema.parse(response);
                if (first.projectPath !== projectPath || first.expiresAt <= Date.now()) throw new Error('Project history manifest scope changed or expired');
                indexSupported = first.indexSupported === true;
                const manifest = { ...first, sessions: [...first.sessions] };
                const seen = new Set(first.sessions.map(row => row.id)), manifestCursors = new Set<string>();
                let part = first;
                while (part.hasNext) {
                    if (!part.sessions.length || !part.nextCursor || manifestCursors.has(part.nextCursor)) throw new Error('Project history manifest cursor did not advance');
                    manifestCursors.add(part.nextCursor);
                    current();
                    const nextInput = { projectPath, snapshotId: first.snapshotId, cursor: part.nextCursor, format: 'manifest' };
                    const next = await (version ? projectGoalRequest(machineId, 'goalProjectConversationCatalog', nextInput, version)
                        : projectGoalRequest(machineId, 'goalProjectConversationCatalog', nextInput));
                    current();
                    if (encoder.encode(JSON.stringify(next)).byteLength > 256 * 1024) throw new Error('Project history manifest page exceeds the size limit');
                    part = GoalProjectConversationCatalogManifestPageSchema.parse(next);
                    if (part.projectPath !== first.projectPath || part.snapshotId !== first.snapshotId || part.catalogFingerprint !== first.catalogFingerprint
                        || part.total !== first.total || part.expiresAt !== first.expiresAt || part.indexSupported !== first.indexSupported) throw new Error('Project history manifest changed between pages');
                    for (const row of part.sessions) {
                        if (seen.has(row.id)) throw new Error('Project history manifest contains duplicate identities');
                        seen.add(row.id); manifest.sessions.push(row);
                    }
                    if (manifest.sessions.length > first.total) throw new Error('Project history manifest total is invalid');
                }
                if (manifest.projectPath !== projectPath || manifest.expiresAt <= Date.now() || part.nextCursor
                    || seen.size !== manifest.sessions.length || manifest.sessions.length !== manifest.total) throw new Error('Project history manifest is incomplete or expired');
                const pairs = manifest.sessions.map(row => [row.id, row.metadataVersion] as const).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
                const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(pairs)));
                current();
                if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== manifest.catalogFingerprint)
                    throw new Error('Project history manifest fingerprint is invalid');
                progress(0, manifest.total);
                await readProjectConversationManifestHeaders(machineId, projectPath, manifest, { current, version, onRows: async rows => {
                    await consumeRows(rows, manifest.total, true); progress(versions.size, manifest.total);
                } });
                current();
                // A local reconstruction, not one oversized transport frame.
                // Each actual manifest/repair RPC was bounded independently.
                response = { ...first, sessions: [], hasNext: false, nextCursor: null };
            }
            const page = GoalProjectConversationCatalogPageSchema.parse(response);
            if (page.projectPath !== projectPath) throw new Error('Project history catalog scope changed');
            if (!snapshot) snapshot = page;
            else if (page.snapshotId !== snapshot.snapshotId || page.catalogFingerprint !== snapshot.catalogFingerprint
                || page.total !== snapshot.total || page.expiresAt !== snapshot.expiresAt) throw new Error('Project history catalog changed between pages');
            if (page.expiresAt <= Date.now()) throw new Error('Project history catalog expired; refresh conversations');
            if (!manifestResponse) await consumeRows(page.sessions, page.total, false);
            current();
            if (!page.hasNext) {
                if (page.nextCursor || versions.size !== page.total) throw new Error('Project history catalog is incomplete');
                progress(versions.size, page.total);
                break;
            }
            if (!page.sessions.length || !page.nextCursor || page.nextCursor === cursor || cursors.has(page.nextCursor))
                throw new Error('Project history catalog cursor did not advance');
            cursors.add(page.nextCursor);
            cursor = page.nextCursor;
            progress(versions.size, page.total);
        } while (cursor);
        const input = JSON.stringify([...versions].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
        const hash = await crypto.subtle.digest('SHA-256', encoder.encode(input));
        current();
        const fingerprint = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (!snapshot || fingerprint !== snapshot.catalogFingerprint) throw new Error('Project history catalog fingerprint is invalid');
        if (indexSupported && indexEntries.length) {
            const base = { projectPath, snapshotId: snapshot.snapshotId, catalogFingerprint: fingerprint };
            let batch: ClassifiedCatalogHeader[] = [], bytes = encoder.encode(JSON.stringify({ ...base, entries: [] })).byteLength;
            const flush = async () => {
                if (!batch.length) return;
                current();
                const result = await projectGoalRequest(machineId, 'goalProjectConversationIndex', { ...base, entries: batch });
                current();
                if (!result || typeof result !== 'object' || !('success' in result) || result.success !== true)
                    throw new Error('Project history classification index could not be saved');
                batch = []; bytes = encoder.encode(JSON.stringify({ ...base, entries: [] })).byteLength;
            };
            for (const entry of indexEntries) {
                const size = encoder.encode(JSON.stringify(entry)).byteLength + 1;
                if (batch.length >= 200 || bytes + size > 192 * 1024) await flush();
                if (bytes + size > 192 * 1024) throw new Error('Project history classification exceeds the request size limit');
                batch.push(entry); bytes += size;
            }
            await flush();
        }
        entry.expiresAt = snapshot.expiresAt;
        entry.total = snapshot.total;
        return { candidates, catalogFingerprint: fingerprint, catalogSnapshotId: snapshot.snapshotId };
    })();
    entry.pending = (cancelled ? Promise.race([read, cancelled]) : read).then(result => {
        current();
        entry.complete = true;
        return result;
    }).catch(error => {
        evict();
        throw error;
    }).finally(() => { detach(); });
    return entry.pending;
}
