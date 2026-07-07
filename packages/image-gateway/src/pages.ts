import type { GatewaySettings, ImageJob } from './types';

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

export function adminPage(settings: GatewaySettings, jobs: ImageJob[], token: string): string {
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
        section { background: #fff; border: 1px solid #dad8d0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        label { display: block; font-weight: 650; margin-bottom: 8px; }
        textarea { width: 100%; box-sizing: border-box; border: 1px solid #c9c6bd; border-radius: 8px; padding: 12px; font: inherit; resize: vertical; }
        button { border: 0; border-radius: 8px; padding: 10px 14px; background: #1f6f5b; color: #fff; font-weight: 650; margin-top: 12px; cursor: pointer; }
        .inline { display: inline; margin-right: 8px; }
        .status { margin-bottom: 14px; color: #555047; }
        .error { color: #a33131; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border-bottom: 1px solid #ece9df; padding: 10px 8px; text-align: left; vertical-align: top; }
        img { max-width: 100%; border-radius: 8px; border: 1px solid #dad8d0; }
        @media (prefers-color-scheme: dark) {
            body { background: #151515; color: #f0eee7; }
            section { background: #20201e; border-color: #3d3a34; }
            textarea { background: #151515; color: #f0eee7; border-color: #4a463f; }
            .status { color: #bbb5a9; }
            th, td { border-bottom-color: #33302b; }
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
