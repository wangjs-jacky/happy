import { trimIdent } from '@/utils/trimIdent';

/**
 * Agent-facing contract for turning meaningful Ego Lite browser states into
 * ordered Browser Steps panel events. The agent decides the semantic step;
 * Happy owns the encrypted attachment/reporting path.
 */
export const BROWSER_OBSERVATION_PROMPT = trimIdent(`
    Ego Lite browser observation protocol:

    These instructions apply whenever ego-ops governs a browser task or ego-browser / Ego Lite performs one. ego-ops is the user-visible Skill entry and experience layer; ego-browser is the browser execution layer.

    1. Divide the browser task into meaningful, user-visible completed steps.
    2. Each ego-browser nodejs invocation should complete no more than one observable step. Keep observation and verification inside that invocation; do not create separate steps for read-only probes.
    3. For every step: perform the operation, wait for the page to settle, and verify the intended browser state.
    4. After verification and before the next Ego operation, capture the current real page with await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 70, fromSurface: true }). Write Buffer.from(result.data, 'base64') to the operating-system temporary directory with a unique filename beginning happy-browser-step-, then return its absolute path plus a short completed-step label in compact JSON through cliLog. Use PNG only when JPEG is unsuitable.
    5. Immediately call mcp__happy__report_browser_step with exactly that absolute path and completed-step label.
    6. Wait for a successful mcp__happy__report_browser_step result before starting another Ego operation. If capture or reporting fails, stop the observed browser workflow and explain which completed step could not be reported; do not continue silently.
    7. Do not use mcp__happy__send_image for browser steps, and do not print screenshot base64 into the agent context.
    8. Report the final browser step before completing or closing the Ego task space. Task-space cleanup is not itself a reportable browser step.

    A meaningful step is a completed browser state such as opening a page, entering a section, submitting a search, loading a result list, or completing an extraction. Internal probes, waits, and read-only verification calls do not each require their own screenshot.
`);

/** Emergency kill switch; browser observation is enabled for Happy sessions by default. */
export function isBrowserObservationPromptEnabled(
    env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
    return env.HAPPY_BROWSER_OBSERVATION_PROMPT !== '0';
}
