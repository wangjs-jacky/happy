// Run only through Ego against a fresh, isolated project-goals fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const config = globalThis.projectLibraryConfig;
assert(config?.runtimePath && Number.isInteger(config.taskSpaceId) && config.targetId);
const runtime = JSON.parse(await fs.readFile(config.runtimePath, 'utf8'));
const task = await taskSpace(config.taskSpaceId), page = task.page('p1');
assert.equal((await task.tabs()).find(tab => tab.label === 'p1')?.targetId, config.targetId);
const url = runtime.webUrl + '/projects?machine=' + encodeURIComponent(runtime.machineId);
assert.equal(await page.url(), url);
const output = path.join(path.dirname(config.runtimePath), 'library-results.json');
const results = [];
const record = async (id, evidence) => {
    results.push({ id, status: 'pass', evidence });
    await fs.writeFile(output, JSON.stringify({ results, boundaries: runtime.boundaries }, null, 2));
    console.log({ id, status: 'pass', evidence });
};
const count = () => page.evaluate(() => document.querySelectorAll('[data-testid^="project-cover-"]').length);
const control = id => `[data-testid="${id}"]`;
const click = id => page.click(control(id));
const wait = id => page.waitForSelector(control(id), { state: 'visible', timeout: 30000 });
const empty = () => wait('project-library-empty');
const favorite = () => page.evaluate(() => document.querySelector('[data-testid="project-favorite-0"]')?.getAttribute('aria-selected') === 'true');
await wait('project-cover-0');
const initial = await count();
assert(initial >= 2);
const projectTitle = await page.evaluate(() => document.querySelector('[data-testid="project-cover-0"]').getAttribute('aria-label'));
assert.equal(await favorite(), false, 'Use a fresh fixture account');

await click('project-favorite-0'); assert.equal(await page.url(), url);
await click('project-filter-favorites'); assert.equal(await count(), 1); assert(await favorite());
await page.reload({ timeout: 60000 }); await wait('project-cover-0');
await click('project-filter-favorites'); assert.equal(await count(), 1); assert(await favorite());
await record('PL1-favorites', { survivesReload: true, separateCardAction: true });

await click('project-more-0'); await wait('project-card-menu');
await page.keyboard.press('Escape');
await page.waitForSelector(control('project-card-menu'), { state: 'hidden' });
assert.equal(await page.url(), url);
await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'project-more-0');
await click('project-more-0'); await click('project-menu-archive'); await empty();
await click('project-filter-archived'); await wait('project-cover-0');
await click('project-more-0'); await click('project-menu-archive'); await empty();
await click('project-filter-favorites'); await wait('project-cover-0'); assert(await favorite());
await record('PL2-archive', { activeViewsExcludeArchived: true, restoredFavorite: true, escapeRestoresFocus: true });

await click('project-more-0'); await click('project-menu-delete');
console.log(await page.snapshot());
await page.click('text="Cancel"'); assert.equal(await count(), 1);
await click('project-more-0'); await click('project-menu-delete'); await page.click('text="Delete"'); await empty();
await page.reload({ timeout: 60000 }); await wait('project-cover-0'); assert.equal(await count(), initial - 1);
await click('project-filter-deleted'); await wait('project-cover-0');
assert.equal(await page.evaluate(() => document.querySelector('[data-testid="project-cover-0"]').getAttribute('aria-label')), projectTitle);
await click('project-more-0'); await click('project-menu-archive'); await empty();
await click('project-filter-favorites'); await wait('project-cover-0'); assert(await favorite());
await record('PL3-delete', { cancelledDeletionPreservesProject: true, deletionSurvivesReload: true, restorePreservesFavorite: true });

const search = 'input[placeholder="Search projects or tasks"]';
await page.fill(search, 'NO-MATCH-LIBRARY-19485'); await empty();
await page.fill(search, ''); await wait('project-cover-0');
await click('project-favorite-0'); await empty(); await click('project-filter-all');
assert.equal(await count(), initial);
await record('PL4-search-empty', { searchWithinFilter: true, unfavoriteEmptyState: true });

const layouts = [];
for (const [width, height] of [[1920, 1080], [1366, 768], [390, 844]]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.waitForFunction(w => innerWidth === w, width);
    const expected = width === 1920 ? 5 : width === 1366 ? 4 : 1;
    await page.waitForFunction(columns => getComputedStyle(document.querySelector('[data-testid="project-gallery"]')).gridTemplateColumns.split(' ').length === columns, expected);
    await click('project-more-0'); await wait('project-card-menu');
    const geometry = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="project-card-menu"]').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - innerWidth, inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
    assert(geometry.overflow <= 1 && geometry.inside);
    await page.keyboard.press('Escape');
    layouts.push({ width, height, columns: expected, ...geometry });
}
await record('PL5-responsive', layouts);
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
assert.equal(await fs.readFile(path.join(runtime.projectPath, 'index.md'), 'utf8').then(text => text.startsWith('#')), true);
