import { stat } from 'node:fs/promises';
import type { ConvertedSnapshot, TranscriptAdapter, TranscriptCandidate } from './adapters/types';
import { claudeCodeAdapter } from './adapters/claudeCode';
import { codexAdapter } from './adapters/codex';
import { scanShareExport, type SecretFinding } from './security/secretScanner';

export type SessionInspection = {
    source: TranscriptCandidate['provider'];
    title: string;
    messageCount: number;
    attachmentCount: number;
    attachmentBytes: number;
    unresolvedAttachmentCount: number;
    blockingFindingCount: number;
    warningFindingCount: number;
};

export type PreparedSessionSnapshot = {
    converted: ConvertedSnapshot;
    findings: SecretFinding[];
    inspection: SessionInspection;
};

function adapterFor(provider: TranscriptCandidate['provider']): TranscriptAdapter {
    return provider === 'codex' ? codexAdapter : claudeCodeAdapter;
}

function disclosure(
    converted: ConvertedSnapshot,
    findings: SecretFinding[],
    source: TranscriptCandidate['provider'],
): SessionInspection {
    return {
        source,
        title: converted.snapshot.title,
        messageCount: converted.snapshot.messages.length,
        attachmentCount: converted.attachments.length,
        attachmentBytes: converted.attachments.reduce((sum, attachment) => sum + attachment.size, 0),
        unresolvedAttachmentCount: converted.unresolvedAttachments.length,
        blockingFindingCount: findings.filter((finding) => finding.severity === 'block').length,
        warningFindingCount: findings.filter((finding) => finding.severity === 'warn').length,
    };
}

export async function prepareSessionSnapshot(candidate: TranscriptCandidate): Promise<PreparedSessionSnapshot> {
    let converted: ConvertedSnapshot | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const before = await stat(candidate.path);
        try {
            converted = await adapterFor(candidate.provider).convert(candidate);
        } catch (error) {
            if (attempt === 0 && (error as Error).message.includes('Session changed while it was being read')) continue;
            throw error;
        }
        const after = await stat(candidate.path);
        if (before.size === after.size && before.mtimeMs === after.mtimeMs) break;
        converted = undefined;
    }
    if (!converted) throw new Error('Session changed while it was being converted; retry after the current turn finishes');
    const findings = await scanShareExport(converted.snapshot, converted.attachments);
    return { converted, findings, inspection: disclosure(converted, findings, candidate.provider) };
}

export async function inspectSession(options: { candidate: TranscriptCandidate }): Promise<SessionInspection> {
    return (await prepareSessionSnapshot(options.candidate)).inspection;
}
