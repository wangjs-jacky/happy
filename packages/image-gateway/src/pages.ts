import type { GatewaySettings, ImageJob, WorkerHealth } from './types';

export function publicPage(settings: GatewaySettings): string {
    return layout('Public Image Gateway', `
        <section>
            <div class="status">Mode: <strong>${escapeHtml(settings.mode.toUpperCase())}</strong> · Today: ${settings.dailySpentEstimateCents}/${settings.dailyBudgetCents} cents</div>
            <form method="post" action="/image/jobs">
                <label for="prompt">Prompt</label>
                <textarea id="prompt" name="prompt" rows="8" maxlength="1200" required placeholder="Describe the image to generate"></textarea>
                <button type="submit">Generate image</button>
            </form>
        </section>
    `);
}

export function jobPage(job: ImageJob): string {
    return layout(`Image Job ${job.id}`, `
        <section>
            <div class="status">Status: <strong>${escapeHtml(job.status)}</strong></div>
            <p>${escapeHtml(job.prompt)}</p>
            ${job.resultUrl ? `<p><a href="${escapeAttribute(job.resultUrl)}">Open generated image</a></p><img src="${escapeAttribute(job.resultUrl)}" alt="Generated image" />` : ''}
            ${job.error ? `<p class="error">${escapeHtml(job.error)}</p>` : ''}
            <p><a href="/image">Submit another</a></p>
        </section>
    `);
}

export function adminPage(settings: GatewaySettings, worker: WorkerHealth, jobs: ImageJob[], token: string): string {
    const health = summarizeWorkerHealth(worker);
    return layout('Image Gateway Admin', `
        <section>
            <div class="status">Mode: <strong>${escapeHtml(settings.mode.toUpperCase())}</strong> · Budget: ${settings.dailySpentEstimateCents}/${settings.dailyBudgetCents} cents</div>
            <form method="post" action="/image/admin/mode?token=${escapeAttribute(token)}" class="inline">
                <button name="mode" value="open" type="submit">Open</button>
                <button name="mode" value="review" type="submit">Review</button>
                <button name="mode" value="closed" type="submit">Closed</button>
            </form>
        </section>
        <section>
            <h2>Worker Health</h2>
            <div class="health-row">
                <span class="badge ${escapeAttribute(health.level)}">${escapeHtml(health.label)}</span>
                <span>${escapeHtml(health.detail)}</span>
            </div>
            <dl class="health-grid">
                <div><dt>Current job</dt><dd>${escapeHtml(worker.currentJobId ?? 'idle')}</dd></div>
                <div><dt>Last seen</dt><dd>${escapeHtml(formatTimestamp(worker.lastSeenAt))}</dd></div>
                <div><dt>Last claim</dt><dd>${escapeHtml(formatEvent(worker.lastClaimAt, worker.lastClaimedJobId))}</dd></div>
                <div><dt>Last success</dt><dd>${escapeHtml(formatEvent(worker.lastCompletedAt, worker.lastCompletedJobId))}</dd></div>
                <div><dt>Last failure</dt><dd>${escapeHtml(formatEvent(worker.lastFailedAt, worker.lastFailedJobId))}</dd></div>
                <div><dt>Polls / claimed / ok / failed</dt><dd>${worker.totalPolls} / ${worker.totalClaimed} / ${worker.totalSucceeded} / ${worker.totalFailed}</dd></div>
            </dl>
            ${worker.lastError ? `<p class="error">${escapeHtml(worker.lastError)}</p>` : ''}
        </section>
        <section>
            <table>
                <thead><tr><th>Status</th><th>Prompt</th><th>Created</th><th>Action</th></tr></thead>
                <tbody>
                    ${jobs.map((job) => `
                        <tr>
                            <td>${escapeHtml(job.status)}</td>
                            <td>${escapeHtml(job.prompt)}</td>
                            <td>${escapeHtml(job.createdAt)}</td>
                            <td>
                                ${job.status === 'pending_review' ? `
                                    <form method="post" action="/image/admin/jobs/${job.id}/approve?token=${escapeAttribute(token)}" class="inline"><button type="submit">Approve</button></form>
                                    <form method="post" action="/image/admin/jobs/${job.id}/reject?token=${escapeAttribute(token)}" class="inline"><button type="submit">Reject</button></form>
                                ` : job.status === 'failed' ? `
                                    <form method="post" action="/image/admin/jobs/${job.id}/retry?token=${escapeAttribute(token)}" class="inline"><button type="submit">Retry</button></form>
                                    <a href="/image/jobs/${job.id}">View</a>
                                ` : `<a href="/image/jobs/${job.id}">View</a>`}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </section>
    `);
}

function layout(title: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
        :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        body { margin: 0; background: #f7f7f4; color: #1b1b18; }
        main { max-width: 880px; margin: 0 auto; padding: 32px 16px; }
        h1 { font-size: 28px; margin: 0 0 20px; }
        h2 { font-size: 18px; margin: 0 0 12px; }
        section { background: #fff; border: 1px solid #dad8d0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        label { display: block; font-weight: 650; margin-bottom: 8px; }
        textarea { width: 100%; box-sizing: border-box; border: 1px solid #c9c6bd; border-radius: 8px; padding: 12px; font: inherit; resize: vertical; }
        button { border: 0; border-radius: 8px; padding: 10px 14px; background: #1f6f5b; color: #fff; font-weight: 650; margin-top: 12px; cursor: pointer; }
        .inline { display: inline; margin-right: 8px; }
        .status { margin-bottom: 14px; color: #555047; }
        .error { color: #a33131; }
        .health-row { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; color: #555047; }
        .badge { display: inline-flex; align-items: center; min-height: 24px; border-radius: 999px; padding: 0 10px; color: #fff; font-size: 13px; font-weight: 700; }
        .badge.online { background: #1f6f5b; }
        .badge.stale { background: #9a650f; }
        .badge.offline { background: #9d3535; }
        .health-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; margin: 0; }
        .health-grid div { min-width: 0; }
        dt { font-size: 12px; color: #6a645b; margin-bottom: 3px; }
        dd { margin: 0; overflow-wrap: anywhere; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #ece9df; padding: 10px 8px; text-align: left; vertical-align: top; }
        img { max-width: 100%; border-radius: 8px; border: 1px solid #dad8d0; }
        @media (prefers-color-scheme: dark) {
            body { background: #151515; color: #f0eee7; }
            section { background: #20201e; border-color: #3d3a34; }
            textarea { background: #151515; color: #f0eee7; border-color: #4a463f; }
            .status { color: #bbb5a9; }
            .health-row { color: #bbb5a9; }
            dt { color: #aaa399; }
            th, td { border-bottom-color: #33302b; }
        }
        @media (max-width: 640px) {
            .health-row { align-items: flex-start; flex-direction: column; }
            .health-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <main>
        <h1>${escapeHtml(title)}</h1>
        ${body}
    </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]!));
}

function escapeAttribute(value: string): string {
    return escapeHtml(value);
}

function summarizeWorkerHealth(worker: WorkerHealth): { level: 'online' | 'stale' | 'offline'; label: string; detail: string } {
    if (!worker.lastSeenAt) {
        return { level: 'offline', label: 'Offline', detail: 'No worker poll has reached this gateway yet.' };
    }
    const ageMs = Date.now() - Date.parse(worker.lastSeenAt);
    if (ageMs <= 30_000) {
        return { level: 'online', label: 'Online', detail: `Last poll ${formatAge(ageMs)} ago.` };
    }
    if (ageMs <= 120_000) {
        return { level: 'stale', label: 'Stale', detail: `Last poll ${formatAge(ageMs)} ago.` };
    }
    return { level: 'offline', label: 'Offline', detail: `Last poll ${formatAge(ageMs)} ago.` };
}

function formatEvent(timestamp?: string, jobId?: string): string {
    if (!timestamp) return 'never';
    return jobId ? `${timestamp} (${jobId})` : timestamp;
}

function formatTimestamp(timestamp?: string): string {
    return timestamp ?? 'never';
}

function formatAge(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
