import type { Session } from './storageTypes';

/** 会话真实工作目录：优先服务端 metadata.path，其次本地 spawnPath 缓存。 */
export function sessionWorkingPath(session?: Session | null): string | null {
    return session?.metadata?.path ?? session?.spawnPath ?? null;
}
