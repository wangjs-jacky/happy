// Run inside an existing Ego round: await checkLayout(task.page('p1')).
// This module never creates a browser or selects a task space.
import assert from 'node:assert/strict';

export async function checkLayout(page) {
  const results = [];
  for (const [width, height] of [[1440, 900], [1440, 700], [1280, 600], [390, 844]]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      composer: document.querySelector('.composer').getBoundingClientRect().toJSON(),
    }));
    assert.ok(geometry.width <= width && geometry.height <= height, `Document overflow at ${width}x${height}: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.composer.bottom <= height && geometry.composer.top >= 0, 'Composer must remain in viewport');
    results.push(`${width}x${height}: viewport fits`);
  }
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.click('[data-action="switch"][data-id="r2"]');
  assert.ok(await page.evaluate(() => !!document.querySelector('.empty-state')), 'Empty room needs a welcome state');
  await page.click('[data-action="mentions"][data-empty]');
  assert.ok(await page.evaluate(() => {
    const menu = document.querySelector('#mention-menu');
    return !menu.hidden && menu.getBoundingClientRect().bottom <= document.querySelector('.compose-box').getBoundingClientRect().top;
  }), 'Mention menu must float above composer');
  await page.press('#draft', 'ArrowDown');
  await page.press('#draft', 'Enter');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.message.user').length), 0, 'Enter picks a member without sending');
  assert.match(await page.evaluate(() => document.querySelector('#draft').value), /^@\S+ $/);
  await page.fill('#draft', '@不存在');
  await page.press('#draft', 'Escape');
  assert.ok(await page.evaluate(() => document.querySelector('#mention-menu').hidden), 'Escape dismisses menu');
  await page.fill('#draft', '只是记一条笔记');
  await page.press('#draft', 'Enter');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.message').length), 1, 'Auto-off room must not reply without @');
  assert.ok(await page.evaluate(() => !document.querySelector('.empty-state')), 'First message replaces welcome');
  results.push('Empty state, floating picker, keyboard selection, Escape, auto-off: pass');
  return results;
}
