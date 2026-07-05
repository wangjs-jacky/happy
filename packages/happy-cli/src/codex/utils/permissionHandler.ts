/**
 * Codex Permission Handler
 *
 * Handles tool permission requests and responses for Codex sessions.
 * Extends BasePermissionHandler with Codex-specific configuration.
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import type { AgentState } from "@/api/types";
import type { PermissionMode } from '@/api/types';
import {
    BasePermissionHandler,
    PermissionResult,
    PendingRequest
} from '@/utils/BasePermissionHandler';

// Re-export types for backwards compatibility
export type { PermissionResult, PendingRequest };

/**
 * Codex-specific permission handler.
 */
export class CodexPermissionHandler extends BasePermissionHandler {
    private currentPermissionMode: PermissionMode = 'default';

    // Exact first-party Happy tool names that should always be auto-approved.
    // Include the bare form (used by Codex elicitation messages like
    // `tool "change_title"`) and the MCP-qualified form for defense in depth.
    private static readonly ALWAYS_AUTO_APPROVE_NAMES: ReadonlySet<string> = new Set([
        'change_title',
        'mcp__happy__change_title',
        'send_image',
        'mcp__happy__send_image',
    ]);

    // Tool-call IDs that should auto-approve when they exactly match one of
    // these values or start with `<name>-` (e.g. `change_title-1765385846663`).
    // Substring matching was a bypass vector — any tool whose ID happened to
    // contain `change_title` as a substring would be silently approved.
    private static readonly ALWAYS_AUTO_APPROVE_ID_PREFIXES: readonly string[] = [
        'change_title',
    ];

    constructor(session: ApiSessionClient) {
        super(session);
    }

    protected getLogPrefix(): string {
        return '[Codex]';
    }

    setPermissionMode(mode: PermissionMode): void {
        const previousMode = this.currentPermissionMode;
        this.currentPermissionMode = mode;
        logger.debug(`${this.getLogPrefix()} Permission mode set to: ${mode}`);

        if (mode === 'yolo' && previousMode !== 'yolo') {
            this.approveAllPending('approved_for_session');
        }
    }

    private shouldAutoApprove(toolName: string, toolCallId: string): boolean {
        if (this.currentPermissionMode === 'yolo') {
            return true;
        }

        if (CodexPermissionHandler.ALWAYS_AUTO_APPROVE_NAMES.has(toolName)) {
            return true;
        }

        for (const prefix of CodexPermissionHandler.ALWAYS_AUTO_APPROVE_ID_PREFIXES) {
            if (toolCallId === prefix || toolCallId.startsWith(`${prefix}-`)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Handle a tool permission request
     * @param toolCallId - The unique ID of the tool call
     * @param toolName - The name of the tool being called
     * @param input - The input parameters for the tool
     * @returns Promise resolving to permission result
     */
    async handleToolCall(
        toolCallId: string,
        toolName: string,
        input: unknown
    ): Promise<PermissionResult> {
        if (this.shouldAutoApprove(toolName, toolCallId)) {
            const decision = this.currentPermissionMode === 'yolo' ? 'approved_for_session' : 'approved';
            logger.debug(`${this.getLogPrefix()} Auto-approving tool ${toolName} (${toolCallId}) in ${this.currentPermissionMode} mode`);

            this.session.updateAgentState((currentState) => ({
                ...currentState,
                completedRequests: {
                    ...currentState.completedRequests,
                    [toolCallId]: {
                        tool: toolName,
                        arguments: input,
                        createdAt: Date.now(),
                        completedAt: Date.now(),
                        status: 'approved',
                        decision,
                    },
                },
            } satisfies AgentState));

            return { decision };
        }

        return new Promise<PermissionResult>((resolve, reject) => {
            // Store the pending request
            this.pendingRequests.set(toolCallId, {
                resolve,
                reject,
                toolName,
                input
            });

            // Update agent state with pending request
            this.addPendingRequestToState(toolCallId, toolName, input);

            logger.debug(`${this.getLogPrefix()} Permission request sent for tool: ${toolName} (${toolCallId})`);
        });
    }
}
