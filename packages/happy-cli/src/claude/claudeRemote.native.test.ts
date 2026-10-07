/** Exercise the real SDK control handshake against a local protocol fixture, without an upstream model call. */
import { it, expect } from 'vitest';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { claudeRemote } from './claudeRemote';
import { claudeIdentityId } from '@/daemon/appDelegation/serviceCapabilities';

it('initializes application Claude before requesting any user input', async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-claude-ready-'));
 const executable=join(root,'claude');
 const login={loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',orgId:'org',accountUuid:'fixture'};
 const original={PATH:process.env.PATH,HAPPY_NATIVE_APPLICATION_POLICY:process.env.HAPPY_NATIVE_APPLICATION_POLICY,ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY,ANTHROPIC_AUTH_TOKEN:process.env.ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL:process.env.ANTHROPIC_BASE_URL};
 try {
  await writeFile(executable,`#!${process.execPath}\nconst readline=require('node:readline');\nif(process.argv.includes('--version')){console.log('2.1.251 (Claude Code)');process.exit(0);}\nif(process.argv.includes('auth')){console.log(${JSON.stringify(JSON.stringify(login))});process.exit(0);}\nconst rl=readline.createInterface({input:process.stdin});\nrl.on('line',line=>{const message=JSON.parse(line);if(message.type==='user')throw Error('No user turn authorized');if(message.type==='control_request')console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{commands:[],models:[],output_style:'default',available_output_styles:['default'],account:{}}}}));});\nrl.on('close',()=>process.exit(0));\n`);
  await chmod(executable,0o700);
  process.env.PATH=root+':'+original.PATH;
  for(const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL'])delete process.env[key];
  process.env.HAPPY_NATIVE_APPLICATION_POLICY=JSON.stringify({directory:root,systemPrompt:'trusted application',binding:{id:'binding',serviceId:'service',appId:'advisor',revision:1,machineId:'machine',engine:'claude',accountRef:{kind:'device-identity',machineId:'machine',identityId:claudeIdentityId(login)},requestedModel:null,reasoning:{mode:'default'},permissions:['chat'],permissionMode:'chat-only'}});
  let ready=false,received=0;
  await claudeRemote({sessionId:null,path:root,allowedTools:[],hookSettingsPath:join(root,'unused.json'),signal:AbortSignal.timeout(10000),
   canCallTool:async()=>({behavior:'deny',message:'No tools'}),onProcessorReady:()=>{ready=true;},
   nextMessage:async()=>{expect(ready).toBe(true);received++;return null;},onReady:()=>{},isAborted:()=>false,onSessionFound:()=>{},onMessage:()=>{}});
  expect(ready).toBe(true);expect(received).toBe(1);
 }finally{
  for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await rm(root,{recursive:true,force:true});
 }
},15000);
