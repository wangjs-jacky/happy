import { describe, it, expect, vi } from 'vitest';
import { VersionController } from './versionController';
const artifact = { id: 'a', workspaceId: 'w', name: 'Doc', kind: 'markdown', entryPath: 'doc.md', managedPaths: ['doc.md'], currentVersionId: 'v3' };
const read = (id = 'v3', text = id) => ({ artifact, entryContent: text, manifest: { entryPath: 'doc.md', files: [{ path: 'doc.md', sha256: 'a'.repeat(64), size: 2, mode: 420, mime: 'text/markdown' }], digest: 'b'.repeat(64) }, readRef: { kind: 'version', versionId: id }, workingRevision: 'b'.repeat(64), workingState: 'clean' });
function setup(extra: Record<string, any> = {}) {
 const rpc = vi.fn(async (method: string, data: any) => {
  if (extra[method]) return extra[method](data);
  if (method === 'artifactCatalog') return [{ root: '/project', workspaceId: 'w', artifacts: [artifact] }];
  if (method === 'artifactRead') return read(data.versionId);
  if (method === 'artifactVersions') return { versions: [1,2,3].map(n => ({ id: 'v'+n, sequence:n })), currentVersionId:'v3' };
  if (method === 'artifactRestore') return { version: {id:'v4'}, workingRevision:'c'.repeat(64) };
 });
 const c = new VersionController('/project', rpc as any); return { c, rpc };
}
const deferred = () => { let resolve!: (v:any)=>void; const promise=new Promise<any>(r=>resolve=r); return {promise,resolve}; };
describe('history state isolation', () => {
 it('discovers managed entry and reads current without selecting history', async () => { const {c}=setup(); await c.current('/project/doc.md'); expect(c.state('/project/doc.md').current?.entryContent).toBe('v3'); expect(c.state('/project/doc.md').selectedId).toBeNull(); });
 it('ignores late history responses, disables restore during loading', async () => {
  const one=deferred(), two=deferred(); const {c}=setup({artifactRead:({versionId}:any)=>versionId==='v1'?one.promise:versionId==='v2'?two.promise:read()});
  await c.current('/project/doc.md'); const a=c.select('/project/doc.md','v1'); const b=c.select('/project/doc.md','v2');
  expect(c.canRestore('/project/doc.md')).toBe(false); one.resolve(read('v1')); await a; expect(c.state('/project/doc.md').preview).toBeNull();
  two.resolve(read('v2')); await b; expect(c.state('/project/doc.md').preview?.entryContent).toBe('v2'); expect(c.state('/project/doc.md').current?.entryContent).toBe('v3');
 });
 it('restores only loaded noncurrent selection, retains operation id without duplicate submit', async () => {
  const done=deferred(); const {c,rpc}=setup({artifactRestore:()=>done.promise}); await c.current('/project/doc.md'); await c.select('/project/doc.md','v1');
  const a=c.restore('/project/doc.md'); await c.restore('/project/doc.md'); expect(rpc.mock.calls.filter(([m])=>m==='artifactRestore')).toHaveLength(1);
  done.resolve({version:{id:'v4'},workingRevision:'c'.repeat(64)}); expect(await a).toBe(true); expect(c.state('/project/doc.md').pending).toBeNull();
 });
 it('keeps uncertain restore inspectable and never silently retries', async () => {
  const {c,rpc}=setup({artifactRestore:()=>{throw new Error('offline')},artifactOperation:()=>({status:'pending',actions:[],observedRevision:'b'.repeat(64),states:[]})});
  await c.current('/project/doc.md'); await c.select('/project/doc.md','v1'); expect(await c.restore('/project/doc.md')).toBe(false);
  const id=c.state('/project/doc.md').pending?.operationId; expect(id).toBeTruthy(); await c.inspect('/project/doc.md'); await c.restore('/project/doc.md');
  expect(c.state('/project/doc.md').pending?.operationId).toBe(id); expect(rpc.mock.calls.filter(([m])=>m==='artifactRestore')).toHaveLength(1);
 });
 it('uses frozen manifest reader and refuses missing historical resources', async () => {
  const {c,rpc}=setup(); await c.current('/project/doc.md'); const r=c.reader(c.state('/project/doc.md').current!);
  await expect(r('/project/missing.png')).rejects.toThrow(); expect(rpc.mock.calls.some(([m])=>m==='artifactResourceRead')).toBe(false);
 });
 it('conflict does not create an uncertain operation and current version cannot restore', async () => {
  const {c}=setup({artifactRestore:()=>{throw Object.assign(new Error('changed'),{detail:{code:'CONFLICT'}})}}); await c.current('/project/doc.md'); await c.select('/project/doc.md','v3'); expect(c.canRestore('/project/doc.md')).toBe(false); await c.select('/project/doc.md','v1'); await c.restore('/project/doc.md'); expect(c.state('/project/doc.md').pending).toBeNull(); expect(c.state('/project/doc.md').error).toBeTruthy();
 });
});

it('retains the committed operation when post-restore refresh fails; no stale current is exposed', async () => {
 let failed=false; const {c}=setup({artifactRestore:()=>{failed=true;return {version:{id:'v4'},workingRevision:'c'.repeat(64)};},artifactRead:(data:any)=>{if(failed)throw new Error('offline');return read(data.versionId);}});
 await c.current('/project/doc.md');await c.select('/project/doc.md','v1'); expect(await c.restore('/project/doc.md')).toBe(false);expect(c.state('/project/doc.md').current).toBeNull();expect(c.state('/project/doc.md').pending).toBeTruthy();
});
it('adopts pending server operations discovered after reopening', async () => {
 const {c}=setup({artifactRead:()=>({...read(),workingState:'recovery-required',pendingOperationId:'server-op'})});await c.load('/project/doc.md');expect(c.state('/project/doc.md').pending?.operationId).toBe('server-op');
});
it('refreshes after explicit rollback instead of reporting the failed transaction as recovery failure', async()=>{
 const {c}=setup({artifactRestore:()=>{throw Object.assign(new Error('partial'),{detail:{code:'PARTIAL_COMMIT'}})},artifactOperation:()=>({status:'pending',actions:['rollback'],observedRevision:'b'.repeat(64),states:[]}),artifactResolveOperation:()=>({status:'failed'})});
 await c.current('/project/doc.md');await c.select('/project/doc.md','v1');await c.restore('/project/doc.md');await c.inspect('/project/doc.md');expect(await c.resolve('/project/doc.md','rollback')).toBe(true);expect(c.state('/project/doc.md').pending).toBeNull();expect(c.state('/project/doc.md').error).toBeNull();
});
it('follows the terminal capture recovery identity on an explicit status check', async()=>{
 const {c}=setup({artifactRead:()=>({...read(),workingState:'recovery-required',pendingOperationId:'terminal'}),artifactOperation:({operationId}:any)=>operationId==='terminal'?{status:'pending',pendingOperationId:'capture',actions:[],observedRevision:'b'.repeat(64),states:[]}:{status:'pending',actions:['rollback'],observedRevision:'b'.repeat(64),states:[]}});
 await c.load('/project/doc.md');await c.inspect('/project/doc.md');expect(c.state('/project/doc.md').pending?.operationId).toBe('capture');expect(c.state('/project/doc.md').operation?.actions).toEqual(['rollback']);
});
it('returns the saved bytes hash even when another writer wins the following current read',async()=>{
 let changed=false;const {c}=setup({artifactSave:()=>{changed=true;return {version:{id:'v4'},workingRevision:'c'.repeat(64)};},artifactRead:()=>read(changed?'v5':'v3')});await c.current('/project/doc.md');
 const result=await c.save('/project/doc.md','my saved bytes','a'.repeat(64));const {createHash}=await import('node:crypto');expect(result.hash).toBe(createHash('sha256').update('my saved bytes').digest('hex'));
});
it('returns the newest accepted current read to both editor and history consumers', async()=>{
 const one=deferred(),two=deferred();let n=0;const {c}=setup({artifactRead:()=>++n===1?one.promise:two.promise});await c.discover('/project/doc.md');
 const first=c.current('/project/doc.md'),second=c.current('/project/doc.md');two.resolve(read('v5'));await second;one.resolve(read('v3'));expect((await first)?.entryContent).toBe('v5');
});
it('normalizes a trailing slash root for entry discovery',async()=>{const {rpc}=setup();const c=new VersionController('/project/',rpc as any);expect((await c.discover('/project/doc.md'))?.id).toBe('a');});
it('does not erase a newly observed recovery after a successful restore',async()=>{
 let restored=false;const {c}=setup({artifactRestore:()=>{restored=true;return {version:{id:'v4'},workingRevision:'c'.repeat(64)};},artifactRead:(d:any)=>restored?{...read(),workingState:'recovery-required',pendingOperationId:'new-recovery'}:read(d.versionId)});
 await c.current('/project/doc.md');await c.select('/project/doc.md','v1');await c.restore('/project/doc.md');expect(c.state('/project/doc.md').pending?.operationId).toBe('new-recovery');
});

it('does not dispatch a delayed restore after its workspace owner was disposed',async()=>{const {c,rpc}=setup();await c.current('/project/doc.md');await c.select('/project/doc.md','v1');c.dispose();expect(c.canRestore('/project/doc.md')).toBe(false);expect(await c.restore('/project/doc.md')).toBe(false);expect(rpc.mock.calls.some(([m])=>m==='artifactRestore')).toBe(false);});
it('allows restoring the marked current snapshot when working files have external unsnapshotted changes',async()=>{const {c}=setup({artifactRead:(d:any)=>({...read(d.versionId),workingState:d.versionId?'clean':'dirty'})});await c.current('/project/doc.md');await c.select('/project/doc.md','v3');expect(c.canRestore('/project/doc.md')).toBe(true);});
