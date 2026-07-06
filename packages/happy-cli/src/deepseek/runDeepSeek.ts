import { randomUUID } from 'node:crypto';

import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import { encodeBase64 } from '@/api/encryption';
import { AcpSessionManager } from '@/agent/acp/AcpSessionManager';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { initialMachineMetadata } from '@/daemon/run';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { Credentials, readSettings } from '@/persistence';
import { parseSpecialCommand } from '@/parsers/specialCommands';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import { connectionState } from '@/utils/serverConnectionErrors';
import { logger } from '@/ui/logger';
import type { SessionEnvelope } from '@slopus/happy-wire';
import type { AgentMessage } from '@/agent/core';
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_FAST_MODEL,
  DEEPSEEK_MODELS,
  DEEPSEEK_PRO_MODEL,
  type DeepSeekChatMessage,
  type DeepSeekThinkingMode,
  streamDeepSeekChat,
} from './deepseekClient';
import { resolveDeepSeekApiKey, type DeepSeekApiKeyResolution } from './deepseekCredentials';

type DeepSeekMode = {
  model: string;
};

export type RunDeepSeekOptions = {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
  model?: string;
};

const DEFAULT_SYSTEM_PROMPT = [
  'You are a fast, concise assistant running inside Happy.',
  'Prioritize low latency and actionable answers.',
  'You do not have shell, filesystem, patch, or MCP tools in this DeepSeek fast mode.',
  'When the user asks for code changes that require tool execution, say that Claude Code or Codex should be used for that step.',
].join('\n');

function hashDeepSeekMode(mode: DeepSeekMode): string {
  return mode.model;
}

function normalizeModel(model: string | null | undefined): string {
  if (!model || model === 'default') {
    return process.env.HAPPY_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || DEEPSEEK_FAST_MODEL;
  }
  if (model.startsWith('deepseek/')) {
    return model.slice('deepseek/'.length);
  }
  return model;
}

function resolveBaseUrl(): string {
  return process.env.HAPPY_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || DEEPSEEK_DEFAULT_BASE_URL;
}

function resolveThinkingMode(model: string): DeepSeekThinkingMode {
  const configured = process.env.HAPPY_DEEPSEEK_THINKING || process.env.DEEPSEEK_THINKING;
  if (configured === 'enabled' || configured === 'disabled') {
    return configured;
  }
  return model === DEEPSEEK_PRO_MODEL ? 'enabled' : 'disabled';
}

function resolveMaxHistoryMessages(): number {
  const raw = process.env.HAPPY_DEEPSEEK_MAX_HISTORY_MESSAGES || process.env.DEEPSEEK_MAX_HISTORY_MESSAGES;
  const parsed = raw ? Number.parseInt(raw, 10) : 20;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

function trimHistory(history: DeepSeekChatMessage[], maxHistoryMessages: number): void {
  const maxLength = maxHistoryMessages + 1;
  if (history.length <= maxLength) {
    return;
  }
  history.splice(1, history.length - maxLength);
}

function formatStatus(model: string, baseUrl: string, historyLength: number, apiKey: DeepSeekApiKeyResolution): string {
  return [
    '**DeepSeek Fast Status**',
    '',
    `Model: ${model}`,
    `Base URL: ${baseUrl}`,
    `Thinking: ${resolveThinkingMode(model)}`,
    `API key: ${apiKey.key ? `configured via ${apiKey.source}` : 'missing'}`,
    `History messages: ${historyLength}`,
    `Cwd: ${process.cwd()}`,
    '',
    'This mode is optimized for fast chat and analysis. It does not run shell commands or edit files.',
  ].join('\n');
}

function usageToTokenCount(usage: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | undefined): AgentMessage | null {
  if (!usage) {
    return null;
  }
  return {
    type: 'token-count',
    totalTokens: usage.total_tokens,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  };
}

export async function runDeepSeek(opts: RunDeepSeekOptions): Promise<void> {
  const sessionTag = randomUUID();
  const initialModel = normalizeModel(opts.model);
  const baseUrl = resolveBaseUrl();
  let apiKey = resolveDeepSeekApiKey();
  connectionState.setBackend('DeepSeek');

  const api = await ApiClient.create(opts.credentials);
  const settings = await readSettings();
  if (!settings?.machineId) {
    throw new Error('No machine ID found in settings');
  }

  await api.getOrCreateMachine({
    machineId: settings.machineId,
    metadata: initialMachineMetadata,
  });

  const { state, metadata } = createSessionMetadata({
    flavor: 'deepseek',
    machineId: settings.machineId,
    startedBy: opts.startedBy,
  });
  metadata.models = [...DEEPSEEK_MODELS];
  metadata.currentModelCode = initialModel;
  metadata.operatingModes = [{ code: 'default', value: 'default', description: 'fast direct API mode' }];
  metadata.currentOperatingModeCode = 'default';
  metadata.slashCommands = ['status', 'clear', 'new'];

  const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

  let session: ApiSessionClient;
  const { session: initialSession, reconnectionHandle } = setupOfflineReconnection({
    api,
    sessionTag,
    metadata,
    state,
    response,
    onSessionSwap: (newSession) => {
      session = newSession;
    },
  });
  session = initialSession;

  if (response) {
    try {
      await notifyDaemonSessionStarted(response.id, metadata, {
        encryptionKey: encodeBase64(response.encryptionKey),
        encryptionVariant: response.encryptionVariant,
        seq: response.seq,
        metadataVersion: response.metadataVersion,
        agentStateVersion: response.agentStateVersion,
      });
    } catch (error) {
      logger.debug('[deepseek] Failed to report session to daemon:', error);
    }
  }

  const sessionManager = new AcpSessionManager();
  const messageQueue = new MessageQueue2<DeepSeekMode>(hashDeepSeekMode);
  const history: DeepSeekChatMessage[] = [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }];
  const maxHistoryMessages = resolveMaxHistoryMessages();
  let currentModel = initialModel;
  let thinking = false;
  let shouldExit = false;
  let waitAbortController = new AbortController();
  let turnAbortController: AbortController | null = null;

  const abortActiveTurn = () => {
    const controller = turnAbortController;
    turnAbortController = null;
    controller?.abort();
  };

  const sendEnvelopes = (envelopes: SessionEnvelope[]) => {
    for (const envelope of envelopes) {
      session.sendSessionProtocolMessage(envelope);
    }
  };

  const sendAgentMessage = (message: AgentMessage) => {
    sendEnvelopes(sessionManager.mapMessage(message));
    if (message.type === 'model-output' && message.fullText) {
      session.sendAgentMessage('deepseek', { type: 'message', message: message.fullText });
    }
  };

  const sendImmediateResponse = (text: string) => {
    sendEnvelopes(sessionManager.startTurn());
    sendAgentMessage({ type: 'model-output', textDelta: text, fullText: text });
    sendEnvelopes(sessionManager.endTurn('completed'));
    session.sendSessionEvent({ type: 'ready' });
  };

  const updateThinking = (next: boolean) => {
    if (thinking === next) {
      return;
    }
    thinking = next;
    session.keepAlive(thinking, 'remote');
  };

  const updateModelMetadata = (model: string) => {
    session.updateMetadata((currentMetadata) => ({
      ...currentMetadata,
      currentModelCode: model,
    }));
  };

  const handleAbort = async () => {
    logger.debug('[deepseek] Abort requested');
    abortActiveTurn();
    waitAbortController.abort();
    waitAbortController = new AbortController();
    updateThinking(false);
  };

  session.rpcHandlerManager.registerHandler('abort', handleAbort);
  registerKillSessionHandler(session.rpcHandlerManager, async () => {
    shouldExit = true;
    messageQueue.close();
    await handleAbort();
  });

  session.onUserMessage((message) => {
    if (!message.content.text) {
      return;
    }
    if (message.meta?.hasOwnProperty('model')) {
      currentModel = normalizeModel(message.meta.model);
      updateModelMetadata(currentModel);
    }
    messageQueue.push(message.content.text, { model: currentModel });
  });

  session.keepAlive(thinking, 'remote');
  const keepAliveInterval = setInterval(() => {
    session.keepAlive(thinking, 'remote');
  }, 2000);

  const runTurn = async (prompt: string, mode: DeepSeekMode) => {
    currentModel = normalizeModel(mode.model);
    updateModelMetadata(currentModel);

    const specialCommand = parseSpecialCommand(prompt);
    if (specialCommand.type === 'clear' || specialCommand.type === 'new') {
      history.splice(1);
      sendImmediateResponse('Started a fresh DeepSeek context.');
      return;
    }
    if (specialCommand.type === 'status') {
      sendImmediateResponse(formatStatus(currentModel, baseUrl, history.length, apiKey));
      return;
    }

    apiKey = resolveDeepSeekApiKey();
    if (!apiKey.key) {
      sendImmediateResponse('DeepSeek API key is not configured. Set DEEPSEEK_API_KEY or HAPPY_DEEPSEEK_API_KEY in the Happy daemon environment, or sign in/configure DeepSeek in OpenCode so ~/.local/share/opencode/auth.json contains a deepseek key.');
      return;
    }

    const controller = new AbortController();
    turnAbortController = controller;
    updateThinking(true);
    sendEnvelopes(sessionManager.startTurn());

    let assistantText = '';
    let status: 'completed' | 'failed' | 'cancelled' = 'completed';
    try {
      const messages: DeepSeekChatMessage[] = [
        ...history,
        { role: 'user', content: prompt },
      ];
      for await (const chunk of streamDeepSeekChat({
        apiKey: apiKey.key,
        baseUrl,
        model: currentModel,
        messages,
        thinking: resolveThinkingMode(currentModel),
        reasoningEffort: 'high',
        signal: controller.signal,
      })) {
        if (chunk.reasoningDelta) {
          sendAgentMessage({
            type: 'event',
            name: 'thinking',
            payload: { text: chunk.reasoningDelta, streaming: true },
          });
        }
        if (chunk.contentDelta) {
          assistantText += chunk.contentDelta;
          sendAgentMessage({ type: 'model-output', textDelta: chunk.contentDelta });
        }
        const tokenCount = usageToTokenCount(chunk.usage);
        if (tokenCount) {
          sendAgentMessage(tokenCount);
        }
      }

      history.push({ role: 'user', content: prompt });
      if (assistantText) {
        history.push({ role: 'assistant', content: assistantText });
      }
      trimHistory(history, maxHistoryMessages);
      session.sendAgentMessage('deepseek', { type: 'message', message: assistantText });
    } catch (error) {
      if (controller.signal.aborted) {
        status = 'cancelled';
      } else {
        status = 'failed';
        const message = error instanceof Error ? error.message : String(error);
        logger.debug('[deepseek] Turn failed:', error);
        sendAgentMessage({ type: 'model-output', textDelta: `DeepSeek error: ${message}` });
      }
    } finally {
      sendEnvelopes(sessionManager.endTurn(status));
      if (turnAbortController === controller) {
        turnAbortController = null;
      }
      updateThinking(false);
      session.sendSessionEvent({ type: 'ready' });
    }
  };

  try {
    session.sendSessionEvent({ type: 'ready' });

    while (!shouldExit) {
      const waitSignal = waitAbortController.signal;
      const batch = await messageQueue.waitForMessagesAndGetAsString(waitSignal);
      if (!batch) {
        if (shouldExit) {
          break;
        }
        if (waitSignal.aborted) {
          continue;
        }
        break;
      }
      await runTurn(batch.message, batch.mode);
    }
  } finally {
    clearInterval(keepAliveInterval);
    reconnectionHandle?.cancel();
    abortActiveTurn();

    try {
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        lifecycleState: 'archived',
        lifecycleStateSince: Date.now(),
        archivedBy: 'cli',
        archiveReason: 'Session ended',
      }));
      session.sendSessionDeath();
      await session.flush();
      await session.close();
    } catch (error) {
      logger.debug('[deepseek] Session close failed:', error);
    }
  }
}
