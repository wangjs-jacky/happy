import fs from 'node:fs/promises';
// This browser container belongs to exactly one controller. Revoke all of its
// dedicated chrome-use workers, never Chromium itself or another container.
for(const entry of await fs.readdir('/proc')){
 if(!/^\d+$/.test(entry))continue;
 try{
  const exe=await fs.readlink(`/proc/${entry}/exe`);
  if(exe==='/usr/local/bin/chrome-use')process.kill(Number(entry),'SIGKILL');
 }catch{}
}
