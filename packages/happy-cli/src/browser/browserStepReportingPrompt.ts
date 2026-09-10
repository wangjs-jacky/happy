import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectPath } from '@/projectPath';

/** Shared Ego evidence contract for Codex, Claude and the session MCP server. */
export const BROWSER_STEP_CAPTURE_MODULE_URL = pathToFileURL(join(projectPath(), 'scripts', 'capture-browser-step.mjs')).href;

export const BROWSER_STEP_REPORTING_INSTRUCTION = `
When using ego-browser, ego-ops or Ego Lite, report screenshots of meaningful completed and verified KEY STEPS to Happy. A key step is a significant navigation, a completed user-visible action, or the final verified result. Do not report waits, retries, tiny scrolls, data extraction, variable inspection, unchanged pages, failed actions or unverified states as separate steps. Combine related reads and checks. Before completing or closing the Ego task space, always report the final verified browser state (once if already reported).
Generate one unique runId for the entire browser task in this Happy session. Reuse it across all Ego nodejs commands and follow-ups for the SAME task space; do not create a new runId per shell command. A different task space, unrelated task, concurrent agent or Happy session must use a different runId. Pass the exact skillName (ego-browser or ego-ops) consistently.
For each key step call mcp__happy__report_browser_step exactly once with path, label, runId and skillName. These frames belong to the Skills progress entry; do not also send them with send_image or as ordinary chat attachments.
Screenshot isolation: select your recorded numeric task-space ID and exact targetId, then verify the intended URL. Never select a task by a shared name or silently recover into another space. Never read, rename, copy or search for ego-browser-shot temporary files or another run's screenshot. At the end of the SAME Ego nodejs round run:
const { captureVerifiedBrowserStep } = await import(${JSON.stringify(BROWSER_STEP_CAPTURE_MODULE_URL)});
cliLog(await captureVerifiedBrowserStep({ cdp, pageInfo, currentTab, listTaskSpaces, useOrCreateTaskSpace }, 'THE_EXACT_EXPECTED_PAGE_URL', { sessionId: 'CURRENT_HAPPY_SESSION_ID', runId: 'YOUR_TASK_RUN_ID', skillName: 'ego-browser', taskSpaceId: YOUR_NUMERIC_TASK_SPACE_ID, targetId: 'YOUR_EXACT_TAB_TARGET_ID' }));
Replace the placeholders using the Happy sessionId supplied below and the task/tab IDs recorded when you opened this task. Do not derive expected IDs or the expected URL blindly from whichever tab is currently selected. The helper verifies ownership and the target before and after capture, writes CDP bytes into a fresh private file and binds its evidence receipt to this session and run. Report only its exact returned path. Keep the receipt beside the image. Never reuse a previous frame path.
If the task space disappears, the user takes control, or the target/URL changes, stop and disclose it. If capture or reporting fails, disclose the missing visual step; never claim the Skills panel updated or send an unverified fallback image.
`;

export function browserCaptureSessionInstruction(sessionId: string): string {
    return `Current Happy browser capture sessionId: ${JSON.stringify(sessionId)}. Use this exact value in captureVerifiedBrowserStep; never reuse another session's capture context.`;
}

export const BROWSER_STEP_TOOL_DESCRIPTION =
    'Report one verified key browser step in the Skills progress entry, not normal chat. Use one runId per browser task across commands. Requires a session/run-bound evidence receipt from captureVerifiedBrowserStep at ' + BROWSER_STEP_CAPTURE_MODULE_URL + '. Unverified or mismatched files are rejected.';
