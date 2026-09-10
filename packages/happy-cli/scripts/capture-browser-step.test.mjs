import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { captureVerifiedBrowserStep as capture } from './capture-browser-step.mjs';

const captureVerifiedBrowserStep = (browser, url) => capture(browser, url, browser.context);

const pngA = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const pngB = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function browser(id, bytes, hook = () => {}) {
    const state = { targetId: id, url: `https://example.test/${id}` };
    return {
        state,
        context: { sessionId: 'session-' + id, runId: 'run-' + id, skillName: 'ego-browser', taskSpaceId: 42, targetId: id },
        async listTaskSpaces() { return [{ id: 42, ownership: 'agent' }]; },
        async useOrCreateTaskSpace(id) { assert.equal(id, 42); return { id }; },
        async currentTab() { return { ...state, title: id }; },
        async pageInfo() { return { url: state.url, w: 800, h: 600 }; },
        async cdp(method, args) {
            // Ego routes Target.* to the browser, while Page.* uses its selected tab.
            if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'browser', url: '', type: 'browser' } };
            assert.equal(method, 'Page.captureScreenshot');
            assert.equal(args.format, 'png');
            assert.equal(args.captureBeyondViewport, false);
            await hook(state);
            return { data: bytes.toString('base64') };
        },
    };
}

test('interleaved tasks and repeated captures retain their own pixels in immutable files', async () => {
    const files = [];
    try {
        const a = browser('paws', pngA);
        const b = browser('stocks', pngB);
        const captures = await Promise.all(Array.from({ length: 12 }, (_, i) => {
            const selected = i % 2 ? b : a;
            return captureVerifiedBrowserStep(selected, selected.state.url);
        }));
        files.push(...captures.map(result => result.path));
        assert.equal(new Set(files).size, 12);
        for (const [i, result] of captures.entries()) {
            assert.deepEqual(await readFile(result.path), i % 2 ? pngB : pngA);
            assert.equal(result.targetId, i % 2 ? 'stocks' : 'paws');
            const receipt = JSON.parse(await readFile(dirname(result.path) + '/evidence.json', 'utf8'));
            assert.equal(receipt.sessionId, i % 2 ? 'session-stocks' : 'session-paws');
            assert.equal(receipt.runId, i % 2 ? 'run-stocks' : 'run-paws');
            if (process.platform !== 'win32') {
                assert.equal((await stat(result.path)).mode & 0o777, 0o600);
                assert.equal((await stat(dirname(result.path))).mode & 0o777, 0o700);
            }
        }
    } finally {
        await Promise.all(files.map(path => rm(dirname(path), { recursive: true, force: true })));
    }
});

test('another tab showing the same URL cannot masquerade as the recorded target', async () => {
    const fake = browser('paws', pngA, () => assert.fail('must not capture'));
    fake.state.targetId = 'other-tab-with-same-url';
    await assert.rejects(captureVerifiedBrowserStep(fake, fake.state.url), /targetId/);
});

test('missing task space or user takeover is rejected before capture', async () => {
    for (const spaces of [[], [{ id: 42, ownership: 'user' }], [{ id: 42, ownership: 'agentDelegatedToUser' }]]) {
        const fake = browser('paws', pngA, () => assert.fail('must not capture'));
        fake.listTaskSpaces = async () => spaces;
        await assert.rejects(captureVerifiedBrowserStep(fake, fake.state.url), /task space/);
    }
});

test('user takeover during screenshot discards even an unchanged target and URL', async () => {
    const fake = browser('paws', pngA);
    let calls = 0;
    fake.listTaskSpaces = async () => [{ id: 42, ownership: calls++ ? 'user' : 'agent' }];
    await assert.rejects(captureVerifiedBrowserStep(fake, fake.state.url), /task space/);
});

test('explicit capture context is mandatory', async () => {
    const fake = browser('paws', pngA);
    await assert.rejects(capture(fake, fake.state.url), /Explicit/);
});

test('wrong page is rejected before taking a screenshot', async () => {
    const fake = browser('stocks', pngB, () => assert.fail('must not capture the wrong page'));
    await assert.rejects(captureVerifiedBrowserStep(fake, 'https://example.test/paws'), /URL/);
});

test('tab switch during capture cannot be reported as a verified screenshot', async () => {
    const fake = browser('paws', pngA, state => { state.targetId = 'another-tab'; });
    await assert.rejects(captureVerifiedBrowserStep(fake, fake.state.url), /changed/);
});

test('navigation during capture cannot be reported as a verified screenshot', async () => {
    const fake = browser('paws', pngA, state => { state.url = 'https://example.test/stocks'; });
    await assert.rejects(captureVerifiedBrowserStep(fake, fake.state.url), /changed/);
});

test('deleted workspace errors propagate without selecting another workspace', async () => {
    const fake = browser('paws', pngA);
    fake.cdp = async () => { throw new Error('Task space no longer exists'); };
    await assert.rejects(captureVerifiedBrowserStep(fake, fake.state.url), /no longer exists/);
});

test('blocked dialogs and empty viewports do not produce evidence', async () => {
    for (const info of [{ dialog: { type: 'alert' } }, { url: 'https://example.test/paws', w: 0, h: 0 }]) {
        const fake = browser('paws', pngA, () => assert.fail('must not capture'));
        fake.pageInfo = async () => info;
        await assert.rejects(captureVerifiedBrowserStep(fake, fake.state.url), /viewport|dialog/);
    }
});

test('empty or non-PNG screenshot responses do not produce evidence', async () => {
    for (const bytes of [Buffer.alloc(0), Buffer.from('not a PNG')]) {
        const fake = browser('paws', bytes);
        await assert.rejects(captureVerifiedBrowserStep(fake, fake.state.url), /PNG/);
    }
});
