const assert = require('node:assert/strict');
const test = require('node:test');
const { featureSummary, featureContext } = require('./pr-feature-context.cjs');

const repo = { owner: 'wangjs-jacky', repo: 'happy' };
const pr = {
    number: 471,
    title: 'fix(app): align usage quota and heatmap interactions',
    body: '## Summary\n\n- Use the current session machine quota.\n- Show Chinese totals in 亿 token.\n\n## Validation\n\n- [x] Tests passed.',
    html_url: 'https://github.com/wangjs-jacky/happy/pull/471',
    merge_commit_sha: 'merged-sha',
    merged_at: '2026-09-07T00:00:00Z',
    base: { ref: 'main', repo: { full_name: 'wangjs-jacky/happy' } },
};

test('prefers the user-facing feature section over technical Summary and template instructions', () => {
    const summary = featureSummary('## Summary\nInternal refactor.\n## 功能说明\n<!-- 写清楚功能 -->\n额度按当前机器显示。\n\n- 中文用量使用亿 token。\n## Visual evidence\nDo not copy this.');
    assert.equal(summary, '额度按当前机器显示。\n\n- 中文用量使用亿 token。');
});

test('old PRs use Summary without leaking validation checklists', () => {
    assert.equal(featureSummary(pr.body), '- Use the current session machine quota.\n- Show Chinese totals in 亿 token.');
});

test('an unfilled feature template falls back to Summary', () => {
    assert.equal(featureSummary('## 功能说明\n<!-- Fill this in -->\n## Summary\nFixed image paste duplication.\n## Validation\nTests.'), 'Fixed image paste duplication.');
    assert.equal(featureSummary(null), '');
    assert.equal(featureSummary('## Validation\n- [x] Passed'), '');
});

test('long summaries are bounded and keep the start of the feature description', () => {
    const summary = featureSummary('## Feature\n' + '功能说明'.repeat(500));
    assert.ok(summary.startsWith('功能说明'));
    assert.ok(summary.length <= 1000);
    assert.ok(summary.endsWith('…'));
});

test('preview notifications identify the PR and expose its actual feature before any version data', async () => {
    const result = await featureContext({ context: { repo, payload: { pull_request: pr } } });
    assert.ok(result.includes('[PR #471](https://github.com/wangjs-jacky/happy/pull/471)'));
    assert.ok(result.includes(pr.title));
    assert.ok(result.includes('Use the current session machine quota.'));
    assert.ok(!result.includes('Tests passed'));
});

test('production matches only PRs merged into this repository main at the deployed SHA', async () => {
    const github = {
        rest: { repos: { listPullRequestsAssociatedWithCommit: Symbol('list') } },
        paginate: async (_route, params) => {
            assert.equal(params.commit_sha, 'merged-sha');
            return [
                { ...pr, number: 12, merge_commit_sha: 'other-sha' },
                { ...pr, number: 13, merged_at: null },
                { ...pr, number: 14, base: { ...pr.base, ref: 'release' } },
                { ...pr, number: 15, base: { ...pr.base, repo: { full_name: 'other/happy' } } },
                pr,
            ];
        },
    };
    const result = await featureContext({ github, context: { repo, sha: 'merged-sha', payload: {} } });
    assert.ok(result.includes('[PR #471]'));
    for (const number of [12, 13, 14, 15]) assert.ok(!result.includes(`[PR #${number}]`));
});

test('API failure preserves a useful commit fallback without failing the deployment', async () => {
    const warnings = [];
    const result = await featureContext({
        github: {
            rest: { repos: { listPullRequestsAssociatedWithCommit: Symbol('list') } },
            paginate: async () => { throw new Error('API unavailable'); },
        },
        core: { warning: (message) => warnings.push(message) },
        context: { repo, sha: 'abc123', payload: { head_commit: { message: '修复首屏粘贴图片重复添加\n\nImplementation details' } } },
    });
    assert.ok(result.includes('修复首屏粘贴图片重复添加'));
    assert.ok(result.includes('/commit/abc123'));
    assert.ok(!result.includes('Implementation details'));
    assert.equal(warnings.length, 1);
});

test('manual runs with no matching PR expose the revision and say the feature is unavailable', async () => {
    const result = await featureContext({
        github: {
            rest: { repos: { listPullRequestsAssociatedWithCommit: Symbol('list') } },
            paginate: async () => [],
        },
        context: { repo, sha: 'abc123', payload: {} },
    });
    assert.ok(result.includes('/commit/abc123'));
    assert.ok(result.includes('未找到对应 PR'));
});
