/** Owner-side adapter over the SDK's durable message watcher and daemon lifecycle.
 * A journal is written before every irreversible submission; uncertain sends are
 * reconciled from messages, never replayed as a new model invocation.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ExecutionBinding, TurnActual } from '@slopus/happy-wire';
import type { BoundTurnInput } from './executionBinding';

export type NativePhase = 'connecting'|'preparing'|'starting'|'resuming'|'submitted'|'generating'|'recovering';
export type NativeMessage = { id:string; seq:number; localId:string|null; content:unknown };
export type NativeSession = { id:string; active:boolean; metadata:unknown; agentState:unknown };
export type NativeConversationMessage = { id:string; seq:number; role:'user'|'assistant'; text:string };
export interface NativeSessionHooks {
 connect():Promise<void>;
 get(sessionId:string):Promise<NativeSession>;
 historyPage(sessionId:string,options:{afterSeq:number;limit:number;signal?:AbortSignal}):Promise<{messages:NativeMessage[];hasMore:boolean}>;
 watch(sessionId:string,options:{afterSeq:number;onMessage:(message:NativeMessage)=>void;onError:(error:Error)=>void;signal?:AbortSignal}):Promise<{sync():Promise<void>;unsubscribe():void}>;
 send(input:{sessionId:string;localId:string;text:string;images?:Array<{name:string;mimeType:string;bytes:Uint8Array}>;meta?:Record<string,unknown>;configuration?:{model?:string|null;effort?:'none'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max'|'ultra'|null};signal?:AbortSignal}):Promise<unknown>;
 /** Must enforce the complete binding on creation AND resume; never default credentials. */
 start(input:{binding:ExecutionBinding;sessionId?:string;codexSessionGrant?:string;systemPrompt:string;directory:string}):Promise<{type:'success';sessionId:string}|{type:'error';errorMessage:string}>;
 cancel(sessionId:string):Promise<void>;
}
type RecordValue = Record<string, any>;
function object(value:unknown):RecordValue { return value && typeof value==='object' ? value as RecordValue : {}; }
export function nativeEnvelope(message:NativeMessage):RecordValue {
 const inner=object(object(message.content).content);
 return inner.type==='session' ? object(inner.data) : inner.ev ? inner : {};
}
export function nativeTranscript(messages:NativeMessage[]):NativeConversationMessage[] {
 const rows=new Map<string,{id:string;seq:number;role:'user'|'assistant';text:string}>();
 for(const message of messages) {
  const content=object(message.content), inner=object(content.content), envelope=nativeEnvelope(message);
  if(content.role==='user' && inner.type==='text' && typeof inner.text==='string') rows.set(message.localId||message.id,{id:message.id,seq:message.seq,role:'user',text:inner.text});
  else if(envelope.role==='agent' && !envelope.subagent && envelope.ev?.t==='text' && !envelope.ev.thinking && typeof envelope.ev.text==='string') rows.set(`${envelope.turn||''}:${envelope.codexItemId||envelope.id||message.id}`,{id:message.id,seq:message.seq,role:'assistant',text:envelope.ev.text});
  else if(content.role==='assistant' && inner.type==='text' && typeof inner.text==='string') rows.set(message.id,{id:message.id,seq:message.seq,role:'assistant',text:inner.text});
 }
 return [...rows.values()].sort((a,b)=>a.seq-b.seq);
}
export function assertNativeBinding(session:NativeSession,binding:ExecutionBinding):void {
 const metadata=object(session.metadata),application=object(metadata.application);
 if(metadata.machineId!==binding.machineId || application.appId!==binding.appId || application.bindingId!==binding.id) throw new Error('permission-denied');
 if(binding.engine==='codex' && metadata.codexAccountProfileId!==binding.accountRef.id) throw new Error('account-identity-changed');
}
export async function readNativeHistory(hooks:NativeSessionHooks,sessionId:string,signal?:AbortSignal):Promise<NativeMessage[]> {
 const messages:NativeMessage[]=[]; let afterSeq=0;
 while(true) {
  signal?.throwIfAborted();
  const page=await hooks.historyPage(sessionId,{afterSeq,limit:500,signal});
  for(const message of page.messages) { if(message.seq<=afterSeq) throw new Error('protocol-incompatible'); messages.push(message);afterSeq=message.seq; }
  if(!page.hasMore)return messages;
  if(!page.messages.length)throw new Error('protocol-incompatible');
 }
}
type Journal={sessionId?:string;starting?:boolean;afterSeq?:number;localId:string;submitted?:boolean;readyAfterSeq?:number};
export type NativeEvent={type:'phase';phase:NativePhase}|{type:'text';text:string}|{type:'messages';messages:NativeConversationMessage[]};
export function createNativeSessionRuntime(context:{hooks:NativeSessionHooks;root:string;machineId:string;readyTimeoutMs?:number;pollMs?:number}) {
 const {hooks}=context;
 const save=async(path:string,value:Journal)=>{await writeFile(path+'.tmp',JSON.stringify(value),{mode:0o600});await rename(path+'.tmp',path);};
 return {
  async cancel(binding:ExecutionBinding,requestId:string,sessionId?:string|null):Promise<boolean> {
   const key=createHash('sha256').update(binding.id+'\0'+requestId).digest('hex');
   let journal:Journal;
   try{journal=JSON.parse(await readFile(join(context.root,key+'.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}
   if(!journal.submitted)return true;
   const id=journal.sessionId||sessionId;if(!id)throw new Error('execution-interrupted');
   await hooks.connect();const session=await hooks.get(id);assertNativeBinding(session,binding);
   const history=await readNativeHistory(hooks,id);
   const start=history.map(nativeEnvelope).find(envelope=>envelope.ev?.t==='turn-start'&&Array.isArray(envelope.ev.localIds)&&envelope.ev.localIds.includes(journal.localId));
   if(!start)return false; // A queued or unconfirmed accepted input cannot be called cancelled.
   if(history.some(message=>{const envelope=nativeEnvelope(message);return envelope.turn===start.turn&&envelope.ev?.t==='turn-end';}))return true;
   if(object(session.agentState).turnStatus?.turnId===start.turn)await hooks.cancel(id);
   return false; // Wait for the durable native terminal event before confirming cancellation.
  },
  async snapshot(binding:ExecutionBinding,sessionId:string,signal?:AbortSignal) {
   await hooks.connect(); const session=await hooks.get(sessionId);assertNativeBinding(session,binding);
   const messages=nativeTranscript(await readNativeHistory(hooks,sessionId,signal));
   return {sessionId,messages,active:session.active,phase:object(session.agentState).turnStatus?.status==='running' ? 'generating' as const : undefined};
  },
  async execute(binding:ExecutionBinding,turn:BoundTurnInput,options:{sessionId?:string|null;codexSessionGrant?:string;systemPrompt:string;attach:(sessionId:string)=>Promise<void>},signal:AbortSignal,onEvent:(event:NativeEvent)=>void) {
   if(binding.machineId!==context.machineId || turn.messages.at(-1)?.role!=='user')throw new Error('permission-denied');
   const phase=(phase:NativePhase)=>onEvent({type:'phase',phase});
   const key=createHash('sha256').update(binding.id+'\0'+turn.requestId).digest('hex');
   await mkdir(context.root,{recursive:true,mode:0o700});
   const path=join(context.root,key+'.json');
   let journal:Journal;
   try{journal=JSON.parse(await readFile(path,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;journal={localId:'application:'+key};}
   if(journal.sessionId && options.sessionId && journal.sessionId!==options.sessionId)throw new Error('permission-denied');
   phase('connecting');await hooks.connect();signal.throwIfAborted();phase('preparing');
   let sessionId=journal.sessionId||options.sessionId||undefined;
   if(!sessionId) {
    if(journal.starting)throw new Error('execution-interrupted'); // Unknown spawn result cannot create a second session.
    journal.starting=true;await save(path,journal);phase('starting');
    const directory=join(context.root,'sessions',createHash('sha256').update(binding.id).digest('hex'));
    await mkdir(directory,{recursive:true,mode:0o700});
    const result=await hooks.start({binding,codexSessionGrant:options.codexSessionGrant,systemPrompt:options.systemPrompt,directory});
    if(result.type!=='success')throw new Error('execution-interrupted');
    sessionId=result.sessionId;journal.sessionId=sessionId;journal.readyAfterSeq=0;await save(path,journal);
    await options.attach(sessionId);
   } else {
    journal.sessionId=sessionId;await options.attach(sessionId);
   }
   let session=await hooks.get(sessionId);assertNativeBinding(session,binding);
   if(!journal.submitted && (!session.active || object(session.metadata).lifecycleState==='archived')) {
    phase('resuming');const before=await readNativeHistory(hooks,sessionId,signal);journal.readyAfterSeq=before.at(-1)?.seq||0;await save(path,journal);
    const result=await hooks.start({binding,sessionId,codexSessionGrant:options.codexSessionGrant,systemPrompt:options.systemPrompt,directory:String(object(session.metadata).path||'')});
    if(result.type!=='success'||result.sessionId!==sessionId)throw new Error('execution-interrupted');
   }
   if(!journal.submitted && journal.readyAfterSeq!==undefined) {
    let ready=false,watchError:Error|undefined;
    const baseline=journal.readyAfterSeq;
    const watch=await hooks.watch(sessionId,{afterSeq:baseline,signal,onMessage:message=>{const content=object(message.content);if(message.seq>baseline && content.role==='agent' && content.content?.type==='event' && content.content.data?.type==='ready')ready=true;},onError:error=>{watchError=error;}});
    try {
     const deadline=Date.now()+(context.readyTimeoutMs??60000);
     while(true){signal.throwIfAborted();if(watchError)throw watchError;session=await hooks.get(sessionId);assertNativeBinding(session,binding);if(ready && session.active)break;if(Date.now()>deadline)throw new Error('resource-busy');await new Promise(resolve=>setTimeout(resolve,context.pollMs??250));}
     delete journal.readyAfterSeq;await save(path,journal);
    }finally{watch.unsubscribe();}
   }
   const all=await readNativeHistory(hooks,sessionId,signal);
   if(journal.afterSeq===undefined){journal.afterSeq=all.at(-1)?.seq||0;await save(path,journal);}
   const previous=all.filter(message=>message.seq<=journal.afterSeq!);
   const transcript=nativeTranscript(previous);
   transcript.push({id:journal.localId,seq:journal.afterSeq+1,role:'user',text:turn.messages.at(-1)!.text});
   onEvent({type:'messages',messages:transcript});
   let userSeq:number|undefined,turnId:string|undefined,status:'completed'|'failed'|'cancelled'|undefined;
   const texts=new Map<string,string>();let resolveDone!:()=>void,rejectDone!:(error:unknown)=>void;
   const done=new Promise<void>((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});done.catch(()=>{});
   const consume=(message:NativeMessage)=>{
    if(message.localId===journal.localId && object(message.content).role==='user')userSeq=message.seq;
    const envelope=nativeEnvelope(message);
    if(envelope.role!=='agent'||envelope.subagent)return;
    if(!turnId && userSeq!==undefined && message.seq>userSeq && envelope.ev?.t==='turn-start' && Array.isArray(envelope.ev.localIds) && envelope.ev.localIds.includes(journal.localId))turnId=envelope.turn;
    if(!turnId || envelope.turn!==turnId)return;
    if(envelope.ev?.t==='text' && !envelope.ev.thinking && typeof envelope.ev.text==='string'){texts.set(envelope.codexItemId||envelope.id||message.id,envelope.ev.text);onEvent({type:'text',text:[...texts.values()].join('\n\n')});}
    if(envelope.ev?.t==='turn-end' && ['completed','failed','cancelled'].includes(envelope.ev.status)){status=envelope.ev.status;resolveDone();}
   };
   const watch=await hooks.watch(sessionId,{afterSeq:journal.afterSeq,signal,onMessage:consume,onError:rejectDone});
   const abort=()=>{rejectDone(signal.reason||new Error('execution-interrupted'));};
   signal.addEventListener('abort',abort,{once:true});
   try {
    signal.throwIfAborted();
    if(!journal.submitted) {
     session=await hooks.get(sessionId);assertNativeBinding(session,binding);
     if(object(session.agentState).turnStatus?.status==='running')throw new Error('resource-busy');
     journal.submitted=true;await save(path,journal);phase('submitted');
     const input=turn.messages.at(-1)!;
     const images=input.images?.map((data,index)=>{const match=/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/.exec(data);if(!match)throw new Error('invalid-request');return {name:`image-${index}`,mimeType:match[1],bytes:new Uint8Array(Buffer.from(match[2],'base64'))};});
     try {await hooks.send({sessionId,localId:journal.localId,text:input.text,images,signal,configuration:{model:binding.requestedModel,effort:binding.reasoning.mode==='explicit' ? binding.reasoning.value as 'low'|'medium'|'high'|'xhigh'|'max' : null},meta:{applicationBindingId:binding.id}});phase('generating');}
     catch{phase('recovering');await watch.sync();} // Ambiguous submission is watched, never resent.
    } else phase('recovering');
    await done;
    const final=await hooks.get(sessionId);assertNativeBinding(final,binding);const metadata=object(final.metadata);
    const actual:TurnActual={modelId:typeof metadata.currentModelCode==='string'?metadata.currentModelCode:null,reasoning:typeof metadata.currentThoughtLevelCode==='string'?metadata.currentThoughtLevelCode:null};
    return {sessionId,status:status!,text:[...texts.values()].join('\n\n'),messages:transcript,actual};
   }catch(error){if(journal.submitted && !status)throw new Error('native-execution-pending',{cause:error});throw error;}finally{signal.removeEventListener('abort',abort);watch.unsubscribe();}
  }
 };
}
