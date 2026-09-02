import {
    App,
    applyDocumentTheme,
    applyHostFonts,
    applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toReadinessViewModel, type ReadinessOutput } from './viewModel.js';
import './styles.css';

const rootElement = document.getElementById('app');
if (!rootElement) throw new Error('Missing MCP App root element');
const root: HTMLElement = rootElement;

function applyHostContext(context: NonNullable<ReturnType<App['getHostContext']>>): void {
    if (context.theme) applyDocumentTheme(context.theme);
    if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
    if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

function isReadinessOutput(value: unknown): value is ReadinessOutput {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<ReadinessOutput>;
    return typeof candidate.releaseName === 'string'
        && typeof candidate.passed === 'number'
        && typeof candidate.total === 'number'
        && typeof candidate.percent === 'number'
        && (candidate.status === 'ready' || candidate.status === 'needs-attention')
        && Array.isArray(candidate.checks)
        && candidate.checks.every((check) => (
            Boolean(check)
            && typeof check === 'object'
            && typeof check.name === 'string'
            && typeof check.passed === 'boolean'
        ));
}

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function renderResult(result: CallToolResult): void {
    if (!isReadinessOutput(result.structuredContent)) {
        const error = element('section', 'error-card', 'The tool returned an invalid readiness payload.');
        error.dataset.testid = 'mcp-app-invalid-result';
        root.replaceChildren(error);
        return;
    }

    const output = result.structuredContent;
    const view = toReadinessViewModel(output);
    const card = element('article', 'readiness-card');
    card.dataset.testid = 'mcp-example-root';
    card.id = 'mcp-app-release-readiness';

    const header = element('header', 'card-header');
    const headingCopy = element('div', 'heading-copy');
    const eyebrow = element('p', 'eyebrow', view.eyebrow);
    const title = element('h1', 'title', view.title);
    title.dataset.testid = 'readiness-title';
    headingCopy.append(eyebrow, title);
    const status = element('span', `status status-${view.statusTone}`, view.statusLabel);
    status.dataset.testid = 'readiness-status';
    header.append(headingCopy, status);

    const scoreSection = element('section', 'score-section');
    const scoreTop = element('div', 'score-top');
    const score = element('strong', 'score', view.score);
    score.dataset.testid = 'readiness-score';
    const percent = element('span', 'percent', view.percentText);
    scoreTop.append(score, percent);
    const progressTrack = element('div', 'progress-track');
    progressTrack.setAttribute('role', 'progressbar');
    progressTrack.setAttribute('aria-label', 'Release readiness');
    progressTrack.setAttribute('aria-valuemin', '0');
    progressTrack.setAttribute('aria-valuemax', '100');
    progressTrack.setAttribute('aria-valuenow', String(output.percent));
    progressTrack.dataset.testid = 'readiness-progress';
    const progressBar = element('div', `progress-bar progress-${view.statusTone}`);
    progressBar.style.width = `${output.percent}%`;
    progressTrack.append(progressBar);
    scoreSection.append(scoreTop, progressTrack);

    const list = element('ul', 'check-list');
    list.dataset.testid = 'readiness-checks';
    for (const row of view.rows) {
        const item = element('li', 'check-row');
        const icon = element('span', `check-icon icon-${row.tone}`, row.tone === 'success' ? '✓' : '!');
        icon.setAttribute('aria-hidden', 'true');
        const label = element('span', 'check-label', row.label);
        const marker = element('span', `check-marker marker-${row.tone}`, row.marker);
        item.append(icon, label, marker);
        list.append(item);
    }

    const action = element('button', 'approval-button', 'Verify mediated action');
    action.type = 'button';
    action.dataset.testid = 'mcp-example-tool-call';
    const actionResult = element('p', 'approval-result');
    actionResult.dataset.testid = 'mcp-example-tool-result';
    action.addEventListener('click', async () => {
        action.disabled = true;
        actionResult.textContent = 'pending';
        try {
            const approval = await app.callServerTool({
                name: 'approve-release-readiness',
                arguments: { releaseName: output.releaseName },
            });
            const structured = approval.structuredContent as { approval?: unknown } | undefined;
            actionResult.textContent = structured?.approval === 'approved' ? 'approved' : 'unexpected';
        } catch {
            actionResult.textContent = 'denied';
        } finally {
            action.disabled = false;
        }
    });
    const actionSection = element('section', 'approval-section');
    actionSection.append(action, actionResult);
    const footer = element('footer', 'card-footer', 'Rendered from structuredContent via MCP Apps');
    card.append(header, scoreSection, list, actionSection, footer);
    root.replaceChildren(card);
}

const app = new App({ name: 'Paws Release Readiness', version: '1.0.0' });
app.ontoolresult = renderResult;
app.onhostcontextchanged = applyHostContext;

void app.connect().then(() => {
    const context = app.getHostContext();
    if (context) applyHostContext(context);
}).catch(() => {
    const error = element('section', 'error-card', 'The MCP App could not connect to its Host.');
    error.dataset.testid = 'mcp-app-connect-error';
    root.replaceChildren(error);
});
