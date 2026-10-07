import { it, expect } from 'vitest';
import { createAIServiceClient } from './client';
import { createNodePlatformTransport } from './nodePlatformTransport';
import { createPlatformServiceHandler } from './nodePlatformHandler';
import { createMemoryServiceStorage } from './storage';
import { binding, fixture, makeReceipt, encrypt } from './testFixtures';
import { validateConversationSnapshot } from './scopedTransport';

it('reads fresh native Paws followups through grant-encrypted, binding-scoped history', async () => {
 const upstream=fixture(); let serial=0,wrong=false;
 const messages=[{id:'1',seq:1,role:'user',text:'hello'},{id:'2',seq:2,role:'assistant',text:'answer'}];
 const transport=createNodePlatformTransport({appId:'advisor',receipt:makeReceipt('platform-grant'),serverUrl:'https://paws.test',storage:createMemoryServiceStorage(),fetch:async (url,init)=>{
  if(!String(url).endsWith('/session')) return upstream.fetcher(url,init);
  const requestId=String(++serial);
  return Response.json({sessionId:'native',requestId,ciphertext:encrypt({protocol:'ai-services/1',direction:'session-history',grantId:'grant',appId:'advisor',serviceId:'service',bindingId:wrong?'foreign':'binding',sessionId:'native',requestId,messages,active:false})});
 }});
 const client=createAIServiceClient({appId:'advisor',transport});await client.connections.authorize();
 expect((await client.conversations.read('binding')).messages).toEqual(messages);
 messages.push({id:'3',seq:3,role:'user',text:'Question from Paws'},{id:'4',seq:4,role:'assistant',text:'Paws response'});
 expect((await client.conversations.read('binding')).messages).toEqual(messages);
 wrong=true;await expect(client.conversations.read('binding')).rejects.toMatchObject({code:'context-mismatch'});
 client.dispose();
});
it('uses native output history instead of stale submitted input', async () => {
 const upstream=fixture();
 const transport=createNodePlatformTransport({appId:'advisor',receipt:makeReceipt('platform-grant'),serverUrl:'https://paws.test',storage:createMemoryServiceStorage(),fetch:async (url,init)=>{
  const response=await upstream.fetcher(url,init);
  if(!String(url).endsWith('/turns/turn')) return response;
  const row=await response.json();
  row.output=encrypt({protocol:'ai-services/1',grantId:'grant',appId:'advisor',serviceId:'service',bindingId:'binding',requestId:'request',turnId:'turn',direction:'output',sequence:1,text:'answer',messages:[{id:'paws',seq:4,role:'user',text:'Paws followup'}]});
  return Response.json(row);
 }});
 await transport.authorize();
 await expect(transport.start({binding,requestId:'request',messages:[{role:'user',text:'hello'}]})).rejects.toMatchObject({code:'transport-error'});
 expect((await transport.read({bindingId:'binding',turnId:'turn'})).messages).toEqual([{id:'paws',seq:4,role:'user',text:'Paws followup'}]);
 transport.dispose();
});
it('checks host ownership before native history and refuses malformed history', async () => {
 const client=createAIServiceClient({appId:'advisor',transport:createNodePlatformTransport({appId:'advisor',receipt:makeReceipt('platform-grant'),serverUrl:'https://paws.test',storage:createMemoryServiceStorage(),fetch:fixture().fetcher})});
 const handler=createPlatformServiceHandler(client,{authorize:async ()=>false,registerConversation:async()=>{},resolveBinding:async()=>binding});
 expect((await handler({method:'GET',path:'/bindings/binding/session'},{})).status).toBe(403);
 for(const value of [{sessionId:null,messages:[{role:'user',text:'invalid'}],active:false},{sessionId:'native',messages:[],active:'false'},{sessionId:'native',messages:[],active:false,phase:'imaginary'}]) expect(()=>validateConversationSnapshot(value)).toThrow();
 client.dispose();
});
