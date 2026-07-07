import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { defaultGatewaySettings, defaultWorkerHealth, type GatewaySettings, type ImageGatewaySnapshot, type ImageJob } from './types';

export interface ImageGatewayStore {
    read(): Promise<ImageGatewaySnapshot>;
    write(snapshot: ImageGatewaySnapshot): Promise<void>;
}

export function createMemoryStore(initial?: Partial<ImageGatewaySnapshot>): ImageGatewayStore {
    let snapshot: ImageGatewaySnapshot = {
        settings: {
            ...defaultGatewaySettings,
            ...initial?.settings,
        },
        worker: {
            ...defaultWorkerHealth,
            ...initial?.worker,
        },
        jobs: initial?.jobs ?? [],
    };

    return {
        async read() {
            return cloneSnapshot(snapshot);
        },
        async write(next) {
            snapshot = cloneSnapshot(next);
        },
    };
}

export function createFileStore(path: string): ImageGatewayStore {
    return {
        async read() {
            try {
                const raw = await readFile(path, 'utf8');
                const parsed = JSON.parse(raw) as Partial<ImageGatewaySnapshot>;
                return {
                    settings: {
                        ...defaultGatewaySettings,
                        ...parsed.settings,
                    },
                    worker: {
                        ...defaultWorkerHealth,
                        ...parsed.worker,
                    },
                    jobs: parsed.jobs ?? [],
                };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    return {
                        settings: { ...defaultGatewaySettings },
                        worker: { ...defaultWorkerHealth },
                        jobs: [],
                    };
                }
                throw error;
            }
        },
        async write(snapshot) {
            await mkdir(dirname(path), { recursive: true });
            const tmpPath = `${path}.tmp`;
            await writeFile(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
            await rename(tmpPath, path);
        },
    };
}

function cloneSnapshot(snapshot: ImageGatewaySnapshot): ImageGatewaySnapshot {
    return {
        settings: { ...snapshot.settings },
        worker: { ...defaultWorkerHealth, ...snapshot.worker },
        jobs: snapshot.jobs.map(cloneJob),
    };
}

function cloneJob(job: ImageJob): ImageJob {
    return { ...job };
}

export async function withSnapshot<T>(
    store: ImageGatewayStore,
    update: (snapshot: ImageGatewaySnapshot) => T | Promise<T>,
): Promise<T> {
    const snapshot = await store.read();
    const result = await update(snapshot);
    await store.write(snapshot);
    return result;
}
