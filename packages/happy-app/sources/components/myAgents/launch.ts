import { buildMyAgentPrompt, type MyAgentProfile } from '@slopus/happy-wire';
import type { MyAgentsApi } from './api';
import { storage } from '@/sync/storage';
import { machineListAgentSkills, machineSpawnNewSession, sessionUpdateMetadata } from '@/sync/ops';
import { sync, type LocalMessageQueueReceipt } from '@/sync/sync';
import { ensureSessionHydratedWithRetry } from '@/sync/ensureSessionHydratedWithRetry';
import type { SkillEntry } from '@/sync/skills';
import type { Machine } from '@/sync/storageTypes';
import type { AttachmentPreview } from '@/sync/attachmentTypes';
import { configureSpawnedSession } from '@/hooks/useSpawnSession';
import { MMKV } from 'react-native-mmkv';
import { accountStorageId } from '@/auth/accountRuntime';

const starts = new MMKV({ id: accountStorageId('my-agent-starts') });
const queuedMessages = new Map<string, LocalMessageQueueReceipt>();
const unknownStart = () => new Error('启动结果尚未确认，为避免重复创建，请先在会话列表找回刚才的会话。');

export function missingMyAgentSkills(profile: MyAgentProfile, installed: SkillEntry[]): string[] {
    return profile.skills.filter(s => !s.path || !installed.some(entry => entry.path === s.path)).map(s => s.name);
}
export function selectMyAgentMachine(machines: Machine[], preferred?: string): Machine | undefined {
    const recent = storage.getState().settings.recentMachinePaths;
    const id = preferred ?? recent.find(r => machines.some(m => m.id === r.machineId && m.active))?.machineId;
    return id ? machines.find(m => m.id === id) : machines.find(m => m.active);
}

/** Registers the role in encrypted session metadata before any user message. */
export async function launchMyAgentSession(input: {
    api: MyAgentsApi; profile?: MyAgentProfile; machine: Machine; directory?: string;
    text: string; builder?: boolean; isCurrent: () => boolean;
    pendingSessionId?: string; onSpawned: (id: string) => void;
    attachments?: AttachmentPreview[];
    permissionMode?: string | null; modelMode?: string | null; effortLevel?: string | null; fastMode?: boolean;
}): Promise<string> {
    const assertCurrent = () => { if (!input.isCurrent()) throw new Error('操作已取消。'); };
    assertCurrent();
    let profile = input.profile ? await input.api.get(input.profile.id) : undefined;
    assertCurrent();
    if (profile?.archived && !input.builder) throw new Error('请先恢复这个 Agent。');
    const machineId = profile?.machineId ?? input.machine.id;
    const recentPath = storage.getState().settings.recentMachinePaths.find(r => r.machineId === machineId)?.path;
    const directory = profile?.directory ?? input.directory ?? recentPath ?? input.machine.metadata?.homeDir;
    if (!input.machine.active || input.machine.id !== machineId) throw new Error('执行设备离线，请连接原设备后重试。');
    if (!directory?.startsWith('/')) throw new Error('尚无可用工作目录，请先在普通聊天中选择设备与目录。');
    if (profile && !input.builder) {
        if (profile.setupNotes) throw new Error(`Agent 待配置：${profile.setupNotes}`);
        const installed = await machineListAgentSkills(machineId, directory);
        assertCurrent();
        const missing = missingMyAgentSkills(profile, installed);
        if (missing.length) throw new Error(`缺少 Skills：${missing.join('、')}。请先调整绑定或在原设备安装。`);
    }
    let sessionId = input.pendingSessionId;
    const receiptKey = JSON.stringify([profile?.id ?? '', !!input.builder, machineId, directory, input.text, input.attachments?.map(a => a.id) ?? []]);
    const receipt = starts.getString(receiptKey);
    let queuedIds: string[] | undefined;
    if (!sessionId && receipt) {
        const saved = JSON.parse(receipt) as { sessionId?: string; queuedIds?: string[] };
        queuedIds = saved.queuedIds;
        if (!saved.sessionId) throw unknownStart();
        sessionId = saved.sessionId;
        input.onSpawned(sessionId);
    }
    if (!sessionId) {
        // Persist before RPC dispatch: a reload, blur, or lost response must not
        // silently create a second remote worker for the same request.
        starts.set(receiptKey, '{}');
        const result = await machineSpawnNewSession({ machineId, directory, agent: 'codex' });
        if (result.type !== 'success') {
            if (result.type === 'error' && 'outcomeUnknown' in result && result.outcomeUnknown) throw unknownStart();
            starts.delete(receiptKey);
            throw new Error(result.type === 'error' ? result.errorMessage : '工作目录不存在，请在普通聊天中确认目录。');
        }
        sessionId = result.sessionId;
        starts.set(receiptKey, JSON.stringify({ sessionId }));
        assertCurrent();
        input.onSpawned(sessionId);
    }
    if (!await ensureSessionHydratedWithRetry(sessionId, input.isCurrent)) throw new Error('会话已创建，暂时无法加载。重试会继续同一会话。');
    assertCurrent();
    configureSpawnedSession(sessionId, input);
    if (profile && !input.builder) {
        const session = storage.getState().sessions[sessionId];
        if (!session?.metadata) throw new Error('会话尚未就绪，请重试。');
        const acknowledged = await sessionUpdateMetadata(sessionId, session.metadata, session.metadataVersion, metadata => ({ ...metadata, myAgentId: profile!.id, name: profile!.name }));
        assertCurrent();
        const latest = storage.getState().sessions[sessionId];
        if (!latest) throw new Error('会话已被移除。');
        if (latest.metadataVersion < acknowledged.version) storage.getState().applySessions([{ ...latest, metadata: acknowledged.metadata, metadataVersion: acknowledged.version }]);
        storage.getState().updateSessionModelMode(sessionId, input.modelMode ?? profile.model);
        storage.getState().updateSessionEffortLevel(sessionId, input.effortLevel ?? profile.effort);
        await input.api.request(`/${profile.id}/sessions`, { method: 'POST', body: JSON.stringify({ sessionId, title: input.text.slice(0, 240) }) });
        assertCurrent();
    }
    const prompt = input.builder
        ? `请使用 Happy 内置的 agent-builder Skill。${profile ? `修改已有 Agent，id=${profile.id}；先读取完整档案并保留未要求修改的字段。` : '创建一个可复用的个人 Agent，保存到我的 Agent。'}\n用户的要求：\n${input.text}`
        : input.text;
    if (!queuedIds) {
        const queued = await sync.sendMessage(sessionId, prompt, { source: 'new_session', displayText: input.text, isCurrent: input.isCurrent, attachments: input.attachments });
        queuedIds = [...queued.localIds];
        queuedMessages.set(receiptKey, queued);
        starts.set(receiptKey, JSON.stringify({ sessionId, queuedIds }));
        assertCurrent();
    }
    if (!await sync.awaitLocalMessageProjection(sessionId, queuedIds, queuedMessages.get(receiptKey))) throw new Error('消息已发送，暂时无法显示。重试不会重复发送，也可以打开已创建的会话。');
    assertCurrent();
    starts.delete(receiptKey);
    queuedMessages.delete(receiptKey);
    return sessionId;
}

export { buildMyAgentPrompt };
