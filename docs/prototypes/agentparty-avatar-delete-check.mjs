import assert from 'node:assert/strict';
export async function checkAvatarDelete(page){
  assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.avatar')].every(a=>a.querySelector('img'))),'All avatars must be graphical');
  await page.click('[data-action="library"]');await page.click('[data-action="edit"][data-id="pm"]');
  await page.click('[data-action="avatar-picker"]');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-action="choose-avatar"]').length),24);
  await page.click('[data-action="choose-avatar"][data-id="8"]');await page.click('button[form="agent-form"]');await page.click('[data-action="close"]');
  assert.ok(await page.evaluate(()=>document.querySelector('.message:not(.user) .avatar img').src===document.querySelector('.member[data-id="pm"] .avatar img').src),'Avatar identity consistent');
  await page.click('[data-action="room-menu"][data-id="r1"]');await page.click('[data-action="delete-room"][data-id="r1"]');await page.click('dialog footer [data-action="close"]');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.room-item').length),2,'Cancel preserves room');
  for(const id of ['r1','r2']){await page.click('[data-action="room-menu"][data-id="'+id+'"]');await page.click('[data-action="delete-room"][data-id="'+id+'"]');await page.click('[data-action="confirm-delete"]');}
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.room-item').length),0);
  assert.equal(await page.evaluate(()=>document.querySelector('#agent-count').textContent),'4','Delete must preserve Agent library');
  assert.ok(await page.evaluate(()=>!!document.querySelector('[data-empty-library]')),'Last deletion shows create entry');
  await page.click('[data-empty-library]');await page.fill('input[name="title"]','重新开始');await page.click('input[name="members"][value="pm"]');await page.click('button[form="room-form"]');
  assert.equal(await page.evaluate(()=>document.querySelector('h1').textContent),'重新开始');
  return 'Avatar picker, cancel/delete, library retention and recreate: PASS';
}
