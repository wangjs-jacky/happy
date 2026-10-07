import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeSessionRuntime, nativeTranscript, type NativeMessage, type NativeSessionHooks } from './nativeSessionRuntime';
import type { ExecutionBinding } from '@slopus/happy-wire';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const binding={id:'binding',serviceId:'service',revision:1,appId:'advisor',machineId:'machine',engine:'codex',accountRef:{kind:'codex-profile',id:'precise'},requestedModel:'model',reasoning:{mode:'explicit',value:'medium'},permissions:['chat'],permissionMode:'chat-only'} as ExecutionBinding;
async function fixture() {
 const root=await mkdtemp(join(tmpdir(),'paws-native-'));roots.push(root);
 const messages:NativeMessage[]=[];const listeners=new Set<(message:NativeMessage)=>void>();
 let active=true,running=false,starts=0,sends=0,dropResponse=false;
 const append=(content:unknown,localId:string|null=null)=>{const message={id:String(messages.length+1),seq:messages.length+1,content,localId};messages.push(message);for(const consume of listeners)consume(message);};
 const event=(ev:unknown,turn='turn')=>append({role:'session',content:{type:'session',data:{role:'agent',turn,ev}}});
 const hooks:NativeSessionHooks={
  connect:async()=>{},get:async()=>({id:'session',active,metadata:{machineId:'machine',application:{appId:'advisor',bindingId:'binding'},codexAccountProfileId:'precise',path:root},agentState:{turnStatus:{status:running?'running':'completed'}}}),
  historyPage:async(_id,{afterSeq})=>({messages:messages.filter(m=>m.seq>afterSeq),hasMore:false}),
  watch:async(_id,options)=>{const consume=(message:NativeMessage)=>{if(message.seq>options.afterSeq)options.onMessage(message);};listeners.add(consume);messages.forEach(consume);return {sync:async()=>messages.forEach(consume),unsubscribe:()=>{listeners.delete(consume);}};},
  start:async input=>{expect(input.binding.accountRef).toEqual({kind:'codex-profile',id:'precise'});expect(input.binding.permissionMode).toBe('chat-only');starts++;active=true;append({role:'agent',content:{type:'event',data:{type:'ready'}}});return {type:'success',sessionId:'session'};},
  send:async input=>{sends++;append({role:'user',content:{type:'text',text:input.text}},input.localId);event({t:'turn-start',localIds:[input.localId]},input.localId);event({t:'text',text:'answer'},input.localId);event({t:'turn-end',status:'completed'},input.localId);if(dropResponse)throw Error('lost acknowledgment');},cancel:async()=>{throw Error('must not cancel another surface');},
 };
 const runtime=createNativeSessionRuntime({hooks,root,machineId:'machine',readyTimeoutMs:20,pollMs:1});
 const execute=(requestId:string,sessionId?:string,signal=new AbortController().signal)=>runtime.execute(binding,{id:requestId,requestId,conversationId:'conversation',createdAt:0,messages:[{role:'assistant',text:'stale history'},{role:'user',text:requestId}]},{sessionId,systemPrompt:'policy',codexSessionGrant:'exact-grant',attach:async()=>{}},signal,()=>{});
 return {runtime,hooks,execute,messages,append,event,setActive:(value:boolean)=>{active=value;},setRunning:(value:boolean)=>{running=value;},drop:()=>{dropResponse=true;},counts:()=>({starts,sends})};
}
describe('native application sessions',()=>{
 it('spawns once, sends only new input, then reuses the same session',async()=>{const f=await fixture();expect((await f.execute('first')).sessionId).toBe('session');await f.execute('second','session');expect(f.counts()).toEqual({starts:1,sends:2});expect(nativeTranscript(f.messages).filter(m=>m.role==='user').map(m=>m.text)).toEqual(['first','second']);});
 it('resumes the bound session after exit preserving exact identity and permissions',async()=>{const f=await fixture();await f.execute('first');f.setActive(false);await f.execute('second','session');expect(f.counts().starts).toBe(2);});
 it('reconciles dropped send response and repeated request without resending',async()=>{const f=await fixture();f.drop();expect((await f.execute('first')).text).toBe('answer');expect((await f.execute('first','session')).text).toBe('answer');expect(f.counts()).toEqual({starts:1,sends:1});});
 it('rejects another machine/application/account before submitting',async()=>{const f=await fixture();const get=f.hooks.get;f.hooks.get=async id=>({...await get(id),metadata:{machineId:'other'}});await expect(f.execute('first')).rejects.toThrow('permission-denied');expect(f.counts().sends).toBe(0);});
 it('does not send or cancel when a Paws turn is running',async()=>{const f=await fixture();f.setRunning(true);await expect(f.execute('first','session')).rejects.toThrow('resource-busy');expect(f.counts()).toEqual({starts:0,sends:0});});

 it('ignores another queued turn and correlates only the accepted localId',async()=>{
  const f=await fixture();const send=f.hooks.send;
  f.hooks.send=async input=>{f.append({role:'user',content:{type:'text',text:input.text}},input.localId);f.event({t:'turn-start',localIds:['paws-other']},'other');f.event({t:'text',text:'wrong answer'},'other');f.event({t:'turn-end',status:'completed'},'other');return send(input);};
  expect((await f.execute('first')).text).toBe('answer');
 });
 it('worker exit preserves the accepted request and reconciles later without another send',async()=>{
  const f=await fixture();const control=new AbortController();let accepted='';
  f.hooks.send=async input=>{accepted=input.localId;f.append({role:'user',content:{type:'text',text:input.text}},input.localId);f.event({t:'turn-start',localIds:[input.localId]},input.localId);control.abort();};
  await expect(f.execute('first',undefined,control.signal)).rejects.toThrow('native-execution-pending');
  f.event({t:'text',text:'recovered answer'},accepted);f.event({t:'turn-end',status:'completed'},accepted);
  f.hooks.send=async()=>{throw Error('must not resend');};
  expect((await f.execute('first','session')).text).toBe('recovered answer');
 });
 it('cancels an unsubmitted request without touching a Paws execution',async()=>{const f=await fixture();f.setRunning(true);expect(await f.runtime.cancel(binding,'never-submitted','session')).toBe(true);expect(f.counts().sends).toBe(0);});
 it('reads Paws-side followups from native history and excludes private thinking',async()=>{const f=await fixture();await f.execute('first');f.append({role:'user',content:{type:'text',text:'from Paws'}},'paws');f.event({t:'text',text:'private',thinking:true});f.event({t:'text',text:'Paws reply'},'paws');const snapshot=await f.runtime.snapshot(binding,'session');expect(snapshot.messages.map(m=>m.text)).toEqual(['first','answer','from Paws','Paws reply']);expect(snapshot.messages.every(m=>m.id&&m.seq)).toBe(true);});
});
