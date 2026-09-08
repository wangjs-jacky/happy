import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectPath } from '@/projectPath';

/**
 * Shared agent instruction and MCP affordance for Ego browser-step reporting.
 *
 * Provider integrations import these strings so Codex, Claude, and both Happy
 * MCP registration paths expose one consistent behavioral contract.
 */

export const BROWSER_STEP_CAPTURE_MODULE_URL = pathToFileURL(join(projectPath(), 'scripts', 'capture-browser-step.mjs')).href;

const CAPTURE_INSTRUCTION = `
Screenshot isolation: Ego's default captureScreenshot() temporary filenames can be shared across tasks. Never report an ego-browser-shot-<pid>-<counter> file, and do not copy or rename that shared file: it may already contain another task's pixels. Instead, at the end of the SAME Ego nodejs round, after selecting your numeric task-space ID and exact tab and verifying the expected URL, run:
const { captureVerifiedBrowserStep } = await import(${JSON.stringify(BROWSER_STEP_CAPTURE_MODULE_URL)});
cliLog(await captureVerifiedBrowserStep({ cdp, pageInfo, currentTab }, 'THE_EXACT_VERIFIED_PAGE_URL'));
Replace the URL placeholder with the known intended page URL, not a URL blindly read from the current tab. This captures CDP bytes directly into a fresh private file and verifies the tab and URL before and after capture. Pass the returned path to report_browser_step. Every frame must have its own returned path; never reuse a previous frame's path. If the helper cannot be imported on the machine running Ego, copy the helper module to that machine first. If the task space disappears, a user takes control, or the tab/URL changes, stop and disclose it; never fall back to another workspace or a previous screenshot.
`;

export const BROWSER_STEP_REPORTING_INSTRUCTION =
    'Whenever you use `ego-browser`, `ego-ops`, or Ego Lite for browser automation, report every meaningful completed and verified browser round to Happy. Create one newly generated stable runId for each Ego invocation and pass the exact skillName (`ego-browser` or `ego-ops`); reuse it for every reported frame from that invocation, and never reuse it for another invocation. At the end of the round, before starting the next Ego browser round, capture the current browser view as a PNG or JPEG and call `mcp__happy__report_browser_step` exactly once with the absolute screenshot path, a short completed-state label, that runId, and skillName. Do not report waits, retries, tiny scrolls, low-level helper calls, failed actions, or unverified states as separate steps. Before completing or closing the Ego task space, always report the final verified browser state. If screenshot capture or reporting fails, continue the browser task only when safe, disclose the missing visual step, and never claim that the panel was updated.' + CAPTURE_INSTRUCTION;

export const BROWSER_STEP_TOOL_DESCRIPTION =
    'Report one completed and verified Ego browser round with its current PNG/JPEG screenshot in a unique private file. Shared ego-browser-shot temporary files are rejected; use captureVerifiedBrowserStep from ' + BROWSER_STEP_CAPTURE_MODULE_URL + '. Call after each meaningful Ego browser round and before the next round; the frame appears in the dedicated browser-steps panel, not normal chat.';
