// Shared by release notifications. PR text stays data; never interpolate it into shell/JS source.
function featureSummary(body) {
    const text = (body || '').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
    const sections = [...text.matchAll(/^##\s+([^\n]+)\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/gm)];
    for (const heading of [/^(功能说明|Feature)$/i, /^Summary$/i]) {
        const section = sections.find((match) => heading.test(match[1].trim()) && match[2].trim());
        if (section) {
            const summary = section[2].trim();
            return summary.length > 1000 ? summary.slice(0, 999).trimEnd() + '…' : summary;
        }
    }
    return '';
}

function inlineText(value) {
    return String(value).replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]<>]/g, '\\$&');
}

async function featureContext({ github, context, core }) {
    const { owner, repo } = context.repo;
    const repositoryUrl = `${context.serverUrl || 'https://github.com'}/${owner}/${repo}`;
    let prs = context.payload.pull_request ? [context.payload.pull_request] : [];
    if (!prs.length) {
        try {
            const associated = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
                owner, repo, commit_sha: context.sha, per_page: 100,
            });
            prs = associated.filter((pr) => pr.merged_at && pr.merge_commit_sha === context.sha
                && pr.base?.ref === 'main' && pr.base?.repo?.full_name === `${owner}/${repo}`);
        } catch (error) {
            core?.warning(`Unable to resolve PR feature context: ${error.message}`);
        }
    }
    if (prs.length) {
        return prs.map((pr) => [
            `**本次功能：${inlineText(pr.title)}**`,
            `对应 PR：[PR #${pr.number}](${repositoryUrl}/pull/${pr.number})`,
            '',
            featureSummary(pr.body) || 'PR 未填写功能摘要，请打开 PR 查看具体改动。',
        ].join('\n')).join('\n\n');
    }
    const commitTitle = context.payload.head_commit?.message?.split('\n')[0];
    return [
        commitTitle ? `**本次改动：${inlineText(commitTitle)}**` : '**本次改动：未找到对应 PR 的功能说明**',
        `对应提交：[${context.sha.slice(0, 8)}](${repositoryUrl}/commit/${context.sha})`,
    ].join('\n');
}

module.exports = { featureSummary, featureContext };
