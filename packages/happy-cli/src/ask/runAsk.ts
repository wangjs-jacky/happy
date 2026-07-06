import { randomUUID } from 'node:crypto';

import { query, type Options as ClaudeAgentOptions, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { createEnvelope, type SessionTurnEndStatus } from '@slopus/happy-wire';

import { ApiClient } from '@/api/api';
import type { ApiSessionClient } from '@/api/apiSession';
import type { UserMessage } from '@/api/types';
import { initialMachineMetadata } from '@/daemon/run';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { encodeBase64 } from '@/api/encryption';
import type { Credentials } from '@/persistence';
import { readSettings } from '@/persistence';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import { logger } from '@/ui/logger';
import { connectionState } from '@/utils/serverConnectionErrors';

type AskEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type AskClaudeOptions = Pick<ClaudeAgentOptions, 'model' | 'effort' | 'permissionMode' | 'settingSources' | 'includePartialMessages' | 'systemPrompt'> & {
  permissionMode: 'default';
  settingSources: [];
  includePartialMessages: true;
};

type InputStream = {
  iterable: AsyncIterable<SDKUserMessage>;
  push(message: SDKUserMessage): void;
  close(): void;
};

const DEFAULT_ASK_MODEL = 'sonnet';
const DEFAULT_SYSTEM_PROMPT = 'You are Happy Ask mode. Answer questions directly. Do not use tools, inspect local files, run commands, or claim to have modified the user\'s machine.';

export function buildAskClaudeOptions(args: {
  model?: string | null;
  effort?: string | null;
  systemPrompt?: string;
}): AskClaudeOptions {
  const effort = normalizeEffort(args.effort);
  return {
    model: args.model || DEFAULT_ASK_MODEL,
    ...(effort ? { effort } : {}),
    permissionMode: 'default',
    settingSources: [],
    includePartialMessages: true,
    systemPrompt: args.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
  };
}

export async function runAsk(opts: {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
}): Promise<void> {
  const sessionTag = randomUUID();
  connectionState.setBackend('Ask');

  const api = await ApiClient.create(opts.credentials);
  const settings = await readSettings();
  const machineId = settings?.machineId;
  if (!machineId) {
    throw new Error('No machine ID found in settings');
  }

  await api.getOrCreateMachine({
    machineId,
    metadata: initialMachineMetadata,
  });

  const { state, metadata } = createSessionMetadata({
    flavor: 'ask',
    machineId,
    startedBy: opts.startedBy,
    sandbox: settings?.sandboxConfig,
  });
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
    await notifyDaemonSessionStarted(response.id, metadata, {
      encryptionKey: encodeBase64(response.encryptionKey),
      encryptionVariant: response.encryptionVariant,
      seq: response.seq,
      metadataVersion: response.metadataVersion,
      agentStateVersion: response.agentStateVersion,
    }).catch((error) => {
      logger.debug('[ask] Failed to report session to daemon:', error);
    });
  }

  let input: InputStream | null = null;
  let activeQuery: Query | null = null;
  let currentTurnId: string | null = null;
  let currentTurnHadDelta = false;
  let thinking = false;
  let stopped = false;

  const keepAliveTimer = setInterval(() => {
    session.keepAlive(thinking, 'remote');
  }, 5_000);

  const ensureTurn = () => {
    if (currentTurnId) {
      return currentTurnId;
    }
    currentTurnHadDelta = false;
    currentTurnId = randomUUID();
    session.sendSessionProtocolMessage(createEnvelope('agent', { t: 'turn-start' }, { turn: currentTurnId }));
    return currentTurnId;
  };

  const sendText = (text: string, isThinking = false) => {
    if (!text) return;
    const turn = ensureTurn();
    currentTurnHadDelta = true;
    session.sendSessionProtocolMessage(createEnvelope('agent', {
      t: 'text',
      text,
      ...(isThinking ? { thinking: true } : {}),
    }, { turn }));
  };

  const closeTurn = (status: SessionTurnEndStatus) => {
    if (!currentTurnId) return;
    session.sendSessionProtocolMessage(createEnvelope('agent', { t: 'turn-end', status }, { turn: currentTurnId }));
    currentTurnId = null;
    currentTurnHadDelta = false;
    thinking = false;
    session.keepAlive(false, 'remote');
    session.sendSessionEvent({ type: 'ready' });
  };

  const startQuery = (message: UserMessage) => {
    input = createInputStream();
    input.push(makeUserMessage(message.content.text));

    const options = buildAskClaudeOptions({
      model: message.meta?.model,
      effort: message.meta?.effort,
      systemPrompt: message.meta?.customSystemPrompt ?? undefined,
    });

    activeQuery = query({
      prompt: input.iterable,
      options,
    });

    void consumeQuery(activeQuery)
      .catch((error) => {
        logger.debug('[ask] Query failed:', error);
        sendText(error instanceof Error ? error.message : String(error));
        closeTurn('failed');
      })
      .finally(() => {
        activeQuery = null;
        input = null;
        if (!stopped) {
          session.sendSessionEvent({ type: 'ready' });
        }
      });
  };

  const consumeQuery = async (q: Query) => {
    for await (const sdkMessage of q) {
      for (const action of mapAskSdkMessage(sdkMessage)) {
        if (action.type === 'turn-start') {
          thinking = true;
          session.keepAlive(true, 'remote');
          ensureTurn();
        } else if (action.type === 'text') {
          sendText(action.text, action.thinking);
        } else if (action.type === 'assistant-complete') {
          if (!currentTurnHadDelta) {
            sendText(action.text);
            if (action.thinking) {
              sendText(action.thinking, true);
            }
          }
        } else if (action.type === 'turn-end') {
          closeTurn(action.status);
        }
      }
    }
  };

  const handleUserMessage = (message: UserMessage) => {
    if (stopped) return;
    if (!activeQuery || !input) {
      startQuery(message);
      return;
    }
    input.push(makeUserMessage(message.content.text));
  };

  const stop = async (archiveReason = 'User terminated') => {
    if (stopped) return;
    stopped = true;
    clearInterval(keepAliveTimer);
    try {
      input?.close();
      if (currentTurnId) {
        closeTurn('cancelled');
      }
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        lifecycleState: 'archived',
        lifecycleStateSince: Date.now(),
        archivedBy: 'cli',
        archiveReason,
      }));
      session.sendSessionDeath();
      await session.flush();
      await session.close();
      reconnectionHandle?.cancel();
    } finally {
      process.exit(0);
    }
  };

  session.onUserMessage(handleUserMessage);
  session.on('archived', () => {
    void stop('Archived from app');
  });
  session.rpcHandlerManager.registerHandler('abort', async () => {
    try {
      await activeQuery?.interrupt();
    } catch (error) {
      logger.debug('[ask] Interrupt failed:', error);
    }
    closeTurn('cancelled');
  });
  registerKillSessionHandler(session.rpcHandlerManager, stop);

  session.sendSessionEvent({ type: 'ready' });

  await new Promise<void>(() => {
    // Keep the lightweight ask process alive until killed or archived.
  });
}

type AskAction =
  | { type: 'turn-start' }
  | { type: 'text'; text: string; thinking?: boolean }
  | { type: 'assistant-complete'; text: string; thinking?: string }
  | { type: 'turn-end'; status: SessionTurnEndStatus };

export function mapAskSdkMessage(message: SDKMessage): AskAction[] {
  const raw = message as any;
  if (raw.type === 'stream_event') {
    const event = raw.event;
    if (event?.type === 'message_start') {
      return [{ type: 'turn-start' }];
    }
    if (event?.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
        return [{ type: 'text', text: event.delta.text }];
      }
      if (event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
        return [{ type: 'text', text: event.delta.thinking, thinking: true }];
      }
    }
    return [];
  }

  if (raw.type === 'assistant') {
    const text: string[] = [];
    const thinking: string[] = [];
    for (const block of raw.message?.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        text.push(block.text);
      } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        thinking.push(block.thinking);
      }
    }
    return [{ type: 'assistant-complete', text: text.join(''), thinking: thinking.join('') || undefined }];
  }

  if (raw.type === 'result') {
    return [{ type: 'turn-end', status: raw.subtype === 'success' ? 'completed' : 'failed' }];
  }

  return [];
}

function createInputStream(): InputStream {
  const buffer: SDKUserMessage[] = [];
  let pending: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  let closed = false;

  return {
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        return {
          next(): Promise<IteratorResult<SDKUserMessage>> {
            if (buffer.length > 0) {
              return Promise.resolve({ value: buffer.shift()!, done: false });
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => {
              pending = resolve;
            });
          },
          return(): Promise<IteratorResult<SDKUserMessage>> {
            closed = true;
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    },
    push(message) {
      if (closed) return;
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve({ value: message, done: false });
      } else {
        buffer.push(message);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve({ value: undefined, done: true });
      }
    },
  };
}

function makeUserMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  } as SDKUserMessage;
}

function normalizeEffort(effort: string | null | undefined): AskEffort | undefined {
  if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max') {
    return effort;
  }
  return undefined;
}
