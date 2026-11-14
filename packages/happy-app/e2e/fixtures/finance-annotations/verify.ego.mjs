// Run only through ego-browser nodejs. See README for the explicit ownership config.
const cfg = globalThis.financeAcceptanceConfig;
if (!cfg) throw new Error('Explicit task-space, target and capture config required');
const task = await taskSpace(cfg.spaceId);
const page = task.page('p1');
const tabs = await task.tabs();
if (!tabs.some(t => t.label === 'p1' && t.targetId === cfg.targetId)) throw new Error('Target changed');
const { mkdir, writeFile } = await import('node:fs/promises');
const { captureVerifiedBrowserStep } = await import('file:///Users/jacky/.local/state/paws-service-presets/2026-10-07/candidate-e1a6c893c359/source/packages/happy-cli/scripts/capture-browser-step.mjs');
const frames = cfg.output + '/frames';
await mkdir(frames, {recursive:true});
let frame = 0;
const record = async (label) => {
    if (await page.url() !== cfg.url) throw new Error('Unexpected URL');
    const shot = await page.cdp('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
    await writeFile(`${frames}/${String(frame++).padStart(3,'0')}.png`, Buffer.from(shot.data,'base64'));
    console.log({frame:frame-1,label});
};
await page.cdp('Emulation.setDeviceMetricsOverride',{width:cfg.width,height:cfg.height,deviceScaleFactor:1,mobile:false});
await page.goto(cfg.url);
await page.waitForSelector('#chart svg');
const point = async i => await page.evaluate(i=>{
    const m=document.querySelector('#chart svg').getScreenCTM();
    return {x:m.a*(30+i*69)+m.e,y:m.d*80+m.f};
},i);
const readout = async i => await page.waitForFunction(date=>document.querySelector('#chart').innerText.split(/\s+/).includes(date),`09:3${i+1}`, {timeout:2000});
const failures=await page.evaluate(()=>({errors:window.__errors,overflow:document.documentElement.scrollWidth>innerWidth}));
if(failures.errors.length||failures.overflow)throw new Error(JSON.stringify(failures));
await record('initial');
for(let i=0;i<5;i++){
    const p=await point(i);
    await page.mouse.click(p.x,p.y,{label:`验收第 ${i+1} 根 K 线`});
    try { await readout(i); } catch (error) {
        const moved = await point(i);
        // Translation extensions may insert text between measurement and click.
        // Retry only a proven layout shift, never a stable-coordinate product failure.
        if (Math.abs(moved.y-p.y)<1 && Math.abs(moved.x-p.x)<1) throw error;
        await page.mouse.click(moved.x,moved.y,{label:'布局变化后重新定位 K 线'});
        await readout(i);
    }
    await record(`candle-${i+1}`);
}
const a=await point(1),b=await point(3);
await page.mouse.move(a.x,a.y);await page.mouse.down();
for(let i=1;i<=8;i++){
    await page.mouse.move(a.x+(b.x-a.x)*i/8,a.y,{label:'拖动查看逐根价格'});
    await record(`drag-${i}`);
}
await page.mouse.up();await readout(3);
await record('drag-verified');
console.log({case:cfg.case,clicks:5,drag:'pass',overflow:false,errors:[]});
const result=await captureVerifiedBrowserStep({cdp,pageInfo,currentTab,listTaskSpaces,useOrCreateTaskSpace},cfg.url,{sessionId:cfg.sessionId,runId:cfg.runId,skillName:'ego-browser',taskSpaceId:cfg.spaceId,targetId:cfg.targetId});
cliLog(result);
await writeFile(cfg.output+'/result.json',JSON.stringify({case:cfg.case,passed:true,frames:frame,capture:result},null,2));
