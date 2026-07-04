import { sessionArchive, sessionDelete, sessionKill } from '@/sync/ops';
import type { Session } from '@/sync/storageTypes';

export async function bulkArchiveSessions(sessions: Session[]): Promise<void> {
    for (const session of sessions) {
        const killResult = await sessionKill(session.id);
        if (!killResult.success) {
            const archiveResult = await sessionArchive(session.id);
            if (!archiveResult.success) {
                throw new Error(archiveResult.message || `Failed to archive session ${session.id}`);
            }
        }
    }
}

export async function bulkDeleteSessions(sessions: Session[]): Promise<void> {
    for (const session of sessions) {
        if (session.active || session.presence === 'online') {
            await sessionKill(session.id).catch(() => {});
        }

        const deleteResult = await sessionDelete(session.id);
        if (!deleteResult.success) {
            throw new Error(deleteResult.message || `Failed to delete session ${session.id}`);
        }
    }
}
