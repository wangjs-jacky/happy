/** Local synthetic fixture only. Run through ego-browser; never use production credentials. */
export async function verifyAppServiceHistory({ taskSpace, spaceId, origin = 'http://127.0.0.1:14318', onVerified = async () => {} }) {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('Local fixture required');
    const fixture = await (await fetch(`${origin}/__e2e/bootstrap`)).json();
    if (fixture.url !== origin) throw new Error('Fixture origin mismatch');
    const task = await taskSpace(spaceId ?? 'verify synthetic application history');
    const page = task.page('p1');
    await page.goto(origin);
    await page.evaluate(entries => {
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, fixture.localStorage);
    const listUrl = `${origin}/apps/conversations`;
    const row = id => `[data-testid="app-conversation-${id}"]`;
    await page.goto(listUrl);
    await page.waitForSelector(row(fixture.localIDs.serviceConversation), { timeout: 20_000 });
    await page.waitForSelector(row(fixture.localIDs.legacyConversation), { timeout: 20_000 });
    console.log({ spaceId: task.spaceId, tabs: await task.tabs() });
    await onVerified('mixed-list', listUrl, page, task);
    for (const [kind, id, texts] of [
        ['legacy', fixture.localIDs.legacyConversation, ['Legacy fixture question', 'Legacy fixture answer']],
        ['shared', fixture.localIDs.serviceConversation, ['Shared fixture prior question', 'Shared fixture prior answer', 'Shared fixture current question', 'Shared fixture current answer']],
    ]) {
        await page.click(row(id));
        await page.waitForFunction(expected => expected.every(text => document.body.innerText.includes(text)), texts, { timeout: 20_000 });
        await onVerified(kind, `${listUrl}/${id}`, page, task);
    }
    await page.click('[data-testid="sidebar-account-trigger"]');
    await page.click('[data-testid="sidebar-switch-account-ego-history-owner-b"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="sidebar-account-trigger"]')?.getAttribute('aria-label') === 'Fixture B', undefined, { timeout: 20_000 });
    await page.goto(listUrl);
    await page.waitForFunction(() => document.body.innerText.includes('尚无应用会话') && !document.body.innerText.includes('fixture answer'), undefined, { timeout: 20_000 });
    await onVerified('account-isolation', listUrl, page, task);
    await page.click('[data-testid="sidebar-account-trigger"]');
    await page.click('[data-testid="sidebar-switch-account-ego-history-owner-a"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="sidebar-account-trigger"]')?.getAttribute('aria-label') === 'Fixture A', undefined, { timeout: 20_000 });
    await page.goto(listUrl);
    await page.waitForSelector(row(fixture.localIDs.serviceConversation), { timeout: 20_000 });
    await page.click(row(fixture.localIDs.serviceConversation));
    await page.waitForFunction(() => document.body.innerText.includes('Shared fixture current answer'), undefined, { timeout: 20_000 });
    await onVerified('restored-shared', `${listUrl}/${fixture.localIDs.serviceConversation}`, page, task);
    console.log('APPLICATION_HISTORY_ACCEPTANCE_PASS');
    return { task, page };
}
