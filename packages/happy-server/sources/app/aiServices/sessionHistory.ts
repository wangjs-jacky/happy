import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ServicePrincipal } from '@slopus/happy-wire';
import type { AIServiceStore } from '@/app/aiServices/store';
import { authorizeWorkerBinding } from '@/app/aiServices/turns';
import { serviceTransaction } from '@/app/aiServices/transactions';
import { deny } from '@/app/aiServices/errors';
/** The machine decrypts native history; the server brokers only grant-encrypted snapshots. */
export function createSessionHistory(database: PrismaClient, store: AIServiceStore) {
 return {
  async read(principal: ServicePrincipal, bindingId: string) {
   if(principal.kind==='owner') deny('permission-denied');
   const binding=await store.readBinding(principal,principal.scope.appId,bindingId);
   const request=await serviceTransaction(database,principal.ownerId,async tx=>{
    await authorizeWorkerBinding(tx,principal.ownerId,binding.machineId,bindingId);
    const row=await tx.aIServiceBinding.findUniqueOrThrow({where:{id:bindingId}});
    if(!row.sessionId) return null;
    if(!await tx.appChatWorker.findFirst({where:{machineId:binding.machineId,accountId:principal.ownerId,activeUntil:{gt:new Date()},serviceProtocol:'ai-services/1'}})) deny('machine-offline');
    if(row.historyRequestId&&!row.historyCiphertext&&row.historyDeadline&&row.historyDeadline.getTime()>Date.now()) return {requestId:row.historyRequestId,sessionId:row.sessionId,deadline:row.historyDeadline.getTime()};
    if(row.historyCiphertext && row.authorizationId) await tx.appDelegation.update({where:{id:row.authorizationId},data:{storedBytes:{decrement:Buffer.byteLength(row.historyCiphertext)}}});
    const requestId=randomUUID(),deadline=Date.now()+20000;
    await tx.aIServiceBinding.update({where:{id:bindingId},data:{historyRequestId:requestId,historyDeadline:new Date(deadline),historyCiphertext:null}});
    return {requestId,sessionId:row.sessionId,deadline};
   });
   if(!request) return {sessionId:null,requestId:null,ciphertext:null};
   while(Date.now()<request.deadline){
    const row=await database.aIServiceBinding.findUniqueOrThrow({where:{id:bindingId}});
    if(row.historyRequestId!==request.requestId) deny('execution-interrupted');
    if(row.historyCiphertext){await store.readBinding(principal,principal.scope.appId,bindingId);return {sessionId:request.sessionId,requestId:request.requestId,ciphertext:row.historyCiphertext};}
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   return deny('execution-interrupted');
  },
  async claim(ownerId:string,machineId:string){
   return serviceTransaction(database,ownerId,async tx=>{
    if(!await tx.machine.findFirst({where:{id:machineId,accountId:ownerId}})) deny('permission-denied');
    const rows=await tx.aIServiceBinding.findMany({where:{ownerId,snapshot:{path:['machineId'],equals:machineId},sessionId:{not:null},historyRequestId:{not:null},historyDeadline:{gt:new Date()},historyCiphertext:null},orderBy:{historyDeadline:'asc'},take:10});
    for(const row of rows){
     const auth=await authorizeWorkerBinding(tx,ownerId,machineId,row.id),envelopes=auth.grant.machineEnvelopes as Record<string,string>|null;
     if(!envelopes?.[machineId]) deny('permission-denied');
     return {id:row.id,sessionId:row.sessionId!,requestId:row.historyRequestId!,binding:auth.binding,grantId:auth.grant.id,ownerId,scope:auth.grant.scope,kind:auth.grant.kind,envelope:envelopes[machineId]};
    }
    return null;
   });
  },
  async publish(ownerId:string,machineId:string,bindingId:string,input:{requestId:string;sessionId:string;ciphertext:string}){
   if(input.ciphertext.length<60||Buffer.byteLength(input.ciphertext)>5*1024*1024) deny('invalid-request');
   return serviceTransaction(database,ownerId,async tx=>{
    const auth = await authorizeWorkerBinding(tx,ownerId,machineId,bindingId);
    const storage = await tx.appDelegation.findUniqueOrThrow({where:{id:auth.grant.id}});
    const bytes = Buffer.byteLength(input.ciphertext);
    if(storage.storedBytes + bytes > 100*1024*1024) deny('resource-busy');
    const updated=await tx.aIServiceBinding.updateMany({where:{id:bindingId,ownerId,sessionId:input.sessionId,historyRequestId:input.requestId,historyDeadline:{gt:new Date()},historyCiphertext:null},data:{historyCiphertext:input.ciphertext}});
    if(!updated.count) deny('execution-interrupted');
    await tx.appDelegation.update({where:{id:auth.grant.id},data:{storedBytes:{increment:bytes}}});
    return {accepted:true};
   });
  },
 };
}
