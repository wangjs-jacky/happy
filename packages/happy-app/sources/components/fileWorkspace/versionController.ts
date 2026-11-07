import type { Artifact, ArtifactReadResult, ArtifactVersion, ArtifactRequests, ArtifactResponses } from '@slopus/happy-wire';
import { ARTIFACT_LIMITS } from '@slopus/happy-wire';
import type { z } from 'zod';
export type VersionRPC = <K extends keyof typeof ArtifactRequests>(method: K, input: z.infer<(typeof ArtifactRequests)[K]>) => Promise<z.infer<(typeof ArtifactResponses)[K]>>;
type Operation = z.infer<typeof ArtifactResponses.artifactOperation>;
export type PendingVersionOperation = { operationId: string; workspaceId: string; kind: 'restore' | 'save' | 'register' };
export type VersionState = {
 artifact: Artifact | null; current: ArtifactReadResult | null; versions: ArtifactVersion[]; cursor?: string;
 selectedId: string | null; preview: ArtifactReadResult | null; loading: boolean; selecting: boolean;
 busy: boolean; error: string | null; pending: PendingVersionOperation | null; operation: Operation | null;
};
const empty = (): VersionState => ({artifact:null,current:null,versions:[],selectedId:null,preview:null,loading:false,selecting:false,busy:false,error:null,pending:null,operation:null});
const errorCode = (e: any) => e?.detail?.code ?? 'UNAVAILABLE';
const ref = (artifact: Artifact) => ({workspaceId:artifact.workspaceId,artifactId:artifact.id});
export class VersionController {
 private snapshot: Record<string,VersionState> = {};
 private listeners = new Set<()=>void>();
 private selections = new Map<string,object>();
 private currentRequests = new Map<string,Promise<ArtifactReadResult|null>>();
 private reads = new Map<string,object>();
 private disposed = false;
 private active() {return !this.disposed && this.valid();}
 constructor(readonly root: string, private rpc: VersionRPC, private valid:()=>boolean=()=>true,
  pending: Record<string,PendingVersionOperation> = {}, private persist?:(p:Record<string,PendingVersionOperation>)=>void) {
  this.root=root.replace(/\/+$/,'') || '/';
  for (const [path,value] of Object.entries(pending)) this.snapshot[path]={...empty(),pending:value};
 }
 getSnapshot=()=>this.snapshot;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 state=(path:string):VersionState=>this.snapshot[path] ?? EMPTY;
 private patch(path:string,change:Partial<VersionState>) {
  if(this.disposed || !this.valid()) return;
  this.snapshot={...this.snapshot,[path]:{...this.state(path),...change}}; this.listeners.forEach(fn=>fn());
  try {this.persist?.(Object.fromEntries(Object.entries(this.snapshot).filter(([,s])=>s.pending).map(([p,s])=>[p,s.pending!])));} catch {this.snapshot={...this.snapshot,[path]:{...this.state(path),error:'LOCAL_STORAGE'}};}
 }
 async discover(path:string) {
  const catalog=await this.rpc('artifactCatalog',{root:this.root});
  const artifact=catalog[0]?.artifacts.find(a=>this.root+'/'+a.entryPath===path) ?? null;
  this.patch(path,{artifact}); return artifact;
 }
 current(path:string):Promise<ArtifactReadResult|null> {
  const token={}; this.reads.set(path,token);
  const request=this.readCurrent(path,token);this.currentRequests.set(path,request);return request;
 }
 private async readCurrent(path:string,token:object):Promise<ArtifactReadResult|null> {
  const a=this.state(path).artifact ?? await this.discover(path);
  if(!a) return null;
  const current=await this.rpc('artifactRead',ref(a));
  if(this.reads.get(path)!==token)return this.currentRequests.get(path)!;
  this.patch(path,{current,artifact:current.artifact,...(current.pendingOperationId ? {pending:{operationId:current.pendingOperationId,workspaceId:current.artifact.workspaceId,kind:'restore' as const}} : {})});
  return current;
 }
 async load(path:string,more=false) {
  if(!this.active() || this.state(path).loading) return false;
  this.patch(path,{loading:true,error:null});
  try {
   const a=this.state(path).artifact ?? await this.discover(path); if(!a) return false;
   await this.current(path);
   const result=await this.rpc('artifactVersions',{...ref(a),...(more && this.state(path).cursor?{cursor:this.state(path).cursor}:{})});
   this.patch(path,{versions:more?[...this.state(path).versions,...result.versions.filter(v=>!this.state(path).versions.some(x=>x.id===v.id))]:result.versions,cursor:result.nextCursor}); return true;
  } catch(e) {this.patch(path,{error:errorCode(e),current:null});return false;} finally {this.patch(path,{loading:false});}
 }
 async register(path:string,managedPaths:string[]) {
  if(!this.active() || this.state(path).busy || this.state(path).pending) return false;
  const operationId=crypto.randomUUID(); this.patch(path,{busy:true,error:null});
  try {
   const artifact=await this.rpc('artifactRegister',{root:this.root,entryPath:path.slice(this.root.length+1),managedPaths,operationId});
   this.patch(path,{artifact}); await this.load(path); return true;
  } catch(e) {
   // Registration may have committed before its reply was lost. Discover once, never resend.
   if(errorCode(e)==='UNAVAILABLE') {try {if(await this.discover(path)) {await this.load(path); return true;}} catch { /* show unknown outcome */ }
    this.patch(path,{pending:{operationId,workspaceId:'',kind:'register'}});
   }
   this.patch(path,{error:errorCode(e)}); return false;
  } finally {this.patch(path,{busy:false});}
 }
 async select(path:string,versionId:string) {
  if(!this.active() || this.state(path).busy || this.state(path).pending) return;
  const artifact=this.state(path).artifact; if(!artifact) return;
  const token={};this.selections.set(path,token);this.patch(path,{selectedId:versionId,preview:null,selecting:true,error:null});
  try {const preview=await this.rpc('artifactRead',{...ref(artifact),versionId});if(this.selections.get(path)===token)this.patch(path,{preview});}
  catch(e){if(this.selections.get(path)===token)this.patch(path,{error:errorCode(e)});}
  finally {if(this.selections.get(path)===token)this.patch(path,{selecting:false});}
 }
 canRestore(path:string) {const s=this.state(path);return this.active() && !!(s.current && s.preview && s.selectedId && s.preview.readRef.kind==='version' && s.preview.readRef.versionId===s.selectedId && (s.selectedId!==s.current.artifact.currentVersionId || s.current.workingState==='dirty') && !s.selecting && !s.loading && !s.busy && !s.pending && !['writing','recovery-required'].includes(s.current.workingState));}
 async restore(path:string) {
  if(!this.canRestore(path))return false;
  const s=this.state(path), operationId=crypto.randomUUID();
  return this.mutate(path,{operationId,workspaceId:s.artifact!.workspaceId,kind:'restore'},()=>this.rpc('artifactRestore',{...ref(s.artifact!),operationId,expectedRevision:s.current!.workingRevision,versionId:s.selectedId!}));
 }
 async save(path:string,content:string,hash:string) {
  const s=this.state(path); if(!this.active() || !s.artifact || !s.current || s.busy || s.pending)throw new Error('VERSION_BUSY');
  if(s.current.manifest.files.find(f=>f.path===s.current!.manifest.entryPath)?.sha256!==hash)throw new Error('VERSION_CONFLICT');
  const operationId=crypto.randomUUID(); const ok=await this.mutate(path,{operationId,workspaceId:s.artifact.workspaceId,kind:'save'},()=>this.rpc('artifactSave',{...ref(s.artifact!),operationId,expectedRevision:s.current!.workingRevision,entryContent:content}));
  if(!ok)throw new Error('VERSION_'+(this.state(path).error??'PENDING'));
  const loaded=this.state(path).current; if(!loaded)throw new Error('VERSION_REFRESH_FAILED');
  const bytes=new TextEncoder().encode(content);
  const digest=await crypto.subtle.digest('SHA-256',bytes as BufferSource);
  return {hash:Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('')};
 }
 private async mutate(path:string,pending:PendingVersionOperation,run:()=>Promise<unknown>) {
  this.patch(path,{busy:true,pending,operation:null,error:null});
  try {await run();this.patch(path,{current:null,selectedId:null,preview:null});}
  catch(e:any) {
   const code=errorCode(e); const uncertain=['UNAVAILABLE','INTERNAL','COMMIT_PENDING','PARTIAL_COMMIT'].includes(code);
   this.patch(path,{error:code,...(!uncertain?{pending:null}:{pending:{...pending,operationId:e?.detail?.operationId??pending.operationId}})});return false;
  } finally {this.patch(path,{busy:false});}
  // A successful mutation and a failed refresh are distinct. Keep success so the file layer reloads.
  const loaded=await this.load(path); if(loaded && !this.state(path).current?.pendingOperationId)this.patch(path,{pending:null,operation:null});return loaded && !this.state(path).current?.pendingOperationId;
 }
 async inspect(path:string) {
  const s=this.state(path);if(!this.active() || !s.pending || s.busy)return false;
  this.patch(path,{busy:true,error:null});
  try {
   if(s.pending.kind==='register') {if(await this.discover(path)) {this.patch(path,{pending:null});await this.load(path);return true;} this.patch(path,{error:'UNAVAILABLE'});return false;}
   let operation=await this.rpc('artifactOperation',{workspaceId:s.pending.workspaceId,operationId:s.pending.operationId});
   if(operation.pendingOperationId) {
    const linked={...s.pending,operationId:operation.pendingOperationId};this.patch(path,{pending:linked});
    operation=await this.rpc('artifactOperation',{workspaceId:linked.workspaceId,operationId:linked.operationId});
   }
   this.patch(path,{operation});
   if(operation.status==='committed'){this.patch(path,{current:null,selectedId:null,preview:null});const loaded=await this.load(path);if(loaded && !this.state(path).current?.pendingOperationId)this.patch(path,{pending:null});return loaded && !this.state(path).current?.pendingOperationId;}
   if(operation.status==='failed' && !operation.actions.length && !operation.pendingOperationId)this.patch(path,{pending:null,error:'INTERNAL'});
   return false;
  }catch(e){this.patch(path,{error:errorCode(e)});return false;}finally{this.patch(path,{busy:false});}
 }
 async resolve(path:string,action:'resume'|'rollback') {
  const s=this.state(path);if(!this.active() || s.busy || !s.pending || !s.operation?.actions.includes(action))return false;
  this.patch(path,{busy:true,error:null});
  try {
   await this.rpc('artifactResolveOperation',{workspaceId:s.pending.workspaceId,operationId:s.pending.operationId,resolutionId:crypto.randomUUID(),action,expectedObservedRevision:s.operation.observedRevision});
   // Inspect on this explicit action only. Never infer a full commit from a resolution reply.
  }catch(e){this.patch(path,{error:errorCode(e)});return false;}finally{this.patch(path,{busy:false});}
  if(action==='rollback'){const loaded=await this.load(path);if(loaded && !this.state(path).current?.pendingOperationId)this.patch(path,{pending:null,operation:null,selectedId:null,preview:null,error:null});return loaded && !this.state(path).current?.pendingOperationId;}
  return this.inspect(path);
 }
 reader(value:ArtifactReadResult) {
  return async (absolute:string):Promise<Uint8Array>=>{
   const path=absolute.startsWith(this.root+'/')?absolute.slice(this.root.length+1):'';
   const file=value.manifest.files.find(f=>f.path===path);if(!file)throw new Error('INCOMPLETE_VERSION');
   const bytes=new Uint8Array(file.size);
   for(let offset=0;offset<file.size;) {
    const chunk=await this.rpc('artifactResourceRead',{...ref(value.artifact),readRef:value.readRef,path,offset,length:Math.min(ARTIFACT_LIMITS.chunk,file.size-offset)});
    const part=Uint8Array.from(atob(chunk.content),c=>c.charCodeAt(0));
    if(chunk.offset!==offset || chunk.sha256!==file.sha256 || chunk.totalSize!==file.size || !part.length || part.length>file.size-offset)throw new Error('INCOMPLETE_VERSION');
    bytes.set(part,offset);offset+=part.length;
   }
   return bytes;
  };
 }
 dispose(){this.disposed=true;this.listeners.clear();this.selections.clear();this.reads.clear();}
}
const EMPTY=empty();
