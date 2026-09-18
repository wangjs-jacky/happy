import assert from 'node:assert/strict';

export async function checkCompact(page) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.members')).display),'none','Members must be closed initially');
  assert.ok(await page.evaluate(()=>document.querySelector('.room-header').offsetHeight<=72),'Header should be compact');
  await page.fill('#draft','保留这条草稿');
  const wide=await page.evaluate(()=>document.querySelector('.conversation').offsetWidth);
  await page.click('[data-action="sidebar"]');
  assert.ok(await page.evaluate(()=>document.querySelector('.sidebar').offsetWidth<=80),'Sidebar must collapse to rail');
  assert.ok(await page.evaluate(()=>document.querySelector('.conversation').offsetWidth)>wide,'Collapse should reclaim chat width');
  await page.click('[data-action="members"]');
  const before=await page.evaluate(()=>document.querySelector('.conversation').offsetWidth);
  assert.ok(await page.evaluate(()=>getComputedStyle(document.querySelector('.members')).display!=='none'),'Members should open');
  await page.press('[data-action="members-close"]','Escape');
  assert.equal(await page.evaluate(()=>document.querySelector('.conversation').offsetWidth),before,'Member overlay must not resize chat');
  assert.equal(await page.evaluate(()=>document.querySelector('#draft').value),'保留这条草稿','Layout changes preserve draft');
  await page.click('[data-action="sidebar"]');
  await page.fill('#draft','');
  return 'Compact header, rail, member overlay, Escape, draft preservation: PASS';
}
