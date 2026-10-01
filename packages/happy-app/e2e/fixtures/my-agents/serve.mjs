// Real RN catalog/card, launch coordinator, CLI Skill tools and ProfileService.
// Only auth, machine RPC, encrypted session storage and model responses are fixtures.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const app = path.join(root, 'packages/happy-app/sources');
const cli = path.join(root, 'packages/happy-cli');
const out = path.join(root, 'test-results/my-agents');
const data = await realpath(await mkdtemp(path.join(tmpdir(), 'paws-my-agents-fixture-')));
const port = Number(process.env.MY_AGENTS_FIXTURE_PORT ?? 18765);
await mkdir(out, { recursive: true });
for (const name of ['grilling', 'show-me']) {
    const dir = path.join(data, '.agents/skills', name); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: 隔离验收方法\n---\n只处理隔离测试数据。`);
}
const serverEntry = `export { ProfileService } from '${root}/packages/paws-agent-party/src/group-chat/profiles.ts';export { createMyAgentToolHandler } from '${cli}/src/agents/myAgentTools.ts';export { listCodexSkillEntries } from '${cli}/src/codex/codexSkills.ts';export { buildMyAgentPrompt } from '${root}/packages/happy-wire/dist/index.mjs';`;
await build({ stdin: { contents: serverEntry, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', banner: { js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);' }, outfile: path.join(out, 'server.mjs'), alias: { '@': path.join(cli, 'src'), '@slopus/happy-wire': path.join(root, 'packages/happy-wire/dist/index.mjs') }, plugins: [{ name: 'fixture-package-root', setup(b) { b.onResolve({ filter: /^@\/projectPath$/ }, () => ({ path: 'root', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const projectPath=()=>${JSON.stringify(cli)};` })); } }] });
const { ProfileService, createMyAgentToolHandler, listCodexSkillEntries, buildMyAgentPrompt } = await import(pathToFileURL(path.join(out, 'server.mjs')));
const profiles = await ProfileService.create(path.join(data, 'account-a'));
const sessions = new Map();
const metadata = { path: data, host: 'fixture', machineId: 'fixture-machine', homeDir: data, happyHomeDir: data, happyLibDir: data, happyToolsDir: data, currentModelCode: 'gpt-6.1-sol', currentThoughtLevelCode: 'high' };
const request = async (suffix, init) => {
    const input = init?.body ? JSON.parse(init.body) : {};
    if (!suffix) return init?.method === 'POST' ? profiles.saveMyAgent(input) : { agents: profiles.list() };
    const [id, operation] = suffix.slice(1).split('/');
    if (operation === 'sessions') return profiles.recordSession(id, input);
    if (operation === 'archive') return profiles.archiveMyAgent(id, input);
    return init?.method === 'PATCH' ? profiles.saveMyAgent(input, id) : profiles.get(id);
};
const invoke = createMyAgentToolHandler({ getMetadata: () => metadata, requestMyAgents: request });
const virtual = {
    'react-native-unistyles': `import{appThemes}from'${app}/themePacks';const theme=appThemes.ginghamDark;export const StyleSheet={create:f=>typeof f==='function'?f(theme,{insets:{top:0,bottom:0}}):f,hairlineWidth:1};export const useUnistyles=()=>({theme});`,
    '@expo/vector-icons': `export const Ionicons=()=>null;`,
    'expo-router': `import React from'react';const listeners=new Set();window.fixtureNavigate=path=>{history.pushState({},'',path);listeners.forEach(fn=>fn())};window.addEventListener('popstate',()=>listeners.forEach(fn=>fn()));export const useRoute=()=>React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>location.pathname+location.search);export const useLocalSearchParams=()=>{useRoute();return Object.fromEntries(new URLSearchParams(location.search))};const router={push:window.fixtureNavigate,replace:window.fixtureNavigate};export const useRouter=()=>router;export const useFocusEffect=fn=>React.useEffect(fn,[fn]);`,
    '@/auth/AuthContext': `const credentials={token:'fixture-account-a'};export const useAuth=()=>({credentials});`,
    '@/auth/accountRuntime': `export const accountRuntimeCurrent=()=>true;export const accountStorageId=id=>'fixture-'+id;`,
    '@/components/agentParty/api': `export const getPartyUrl=()=>'/';`,
    '@/modal': `export const Modal={confirm:async()=>true};`,
    'react-native-mmkv': `export class MMKV{constructor({id}){this.id=id}getString(k){return localStorage.getItem(this.id+k)??undefined}set(k,v){localStorage.setItem(this.id+k,v)}delete(k){localStorage.removeItem(this.id+k)}}`,
    '@/sync/storage': `const state={settings:{recentMachinePaths:[]},sessions:{},applySessions(rows){for(const row of rows)state.sessions[row.id]=row},updateSessionModelMode(){},updateSessionEffortLevel(){}};const machines=[{id:'fixture-machine',active:true,metadata:{displayName:'隔离测试设备',homeDir:${JSON.stringify(data)}}}];export const storage={getState:()=>state};export const useAllMachines=()=>machines;`,
    '@/sync/skills': `export const scanSkills=async()=>{const r=await fetch('/fixture/skills');return r.json()};`,
    '@/sync/ops': `import{storage}from'@/sync/storage';export const machineListAgentSkills=async()=>{const r=await fetch('/fixture/skills');return r.json()};export const machineSpawnNewSession=async()=>{const result=await(await fetch('/fixture/spawn',{method:'POST'})).json();storage.getState().applySessions([{id:result.sessionId,metadata:{path:${JSON.stringify(data)},host:'fixture'},metadataVersion:1}]);return result};export const sessionUpdateMetadata=async(id,metadata,version,fn)=>({metadata:fn(metadata),version:version+1});`,
    '@/sync/ensureSessionHydratedWithRetry': `export const ensureSessionHydratedWithRetry=async()=>true;`,
    '@/sync/sync': `import{storage}from'@/sync/storage';export const sync={checkSessionExists:async()=>true,sendMessage:async(id,text,options)=>{const row=storage.getState().sessions[id];const r=await fetch('/fixture/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,text,displayText:options.displayText,myAgentId:row?.metadata?.myAgentId})});if(!r.ok)throw Error(await r.text())}};`,
};
const client = `import React from'react';import{createRoot}from'react-dom/client';import{View,Text,Pressable}from'react-native';import{useRoute}from'expo-router';import{MyAgentsScreen}from'${app}/components/myAgents/MyAgentsScreen';import{MyAgentCard}from'${app}/components/myAgents/MyAgentCard';import{parseMyAgentCard}from'${app}/utils/sessionMyAgentCard';function Chat({id}){const[data,setData]=React.useState();React.useEffect(()=>{fetch('/fixture/session/'+id).then(r=>r.json()).then(setData)},[id]);const card=data?.response?.match(/<happy-agent>\\s*([\\s\\S]*?)\\s*<\\/happy-agent>/)?.[1];return <View style={{padding:24,gap:16,maxWidth:800,alignSelf:'center',width:'100%'}}><Text style={{fontSize:24,color:'#eadfd1'}}>普通会话</Text><Text style={{color:'#eadfd1',fontSize:16}}>{data?.displayText}</Text>{card?<MyAgentCard card={parseMyAgentCard(card)}/>:<Text style={{color:'#eadfd1',fontSize:16,lineHeight:26}}>{data?.response}</Text>}<Pressable accessibilityRole="button" accessibilityLabel="回到我的 Agent" onPress={()=>window.fixtureNavigate('/my-agents')}><Text style={{color:'#eadfd1',padding:16}}>回到我的 Agent</Text></Pressable></View>}function App(){const route=useRoute();return route.startsWith('/session/')?<Chat id={location.pathname.split('/')[2]}/>:<MyAgentsScreen/>}createRoot(document.getElementById('app')).render(<App/>);`;
await build({ stdin: { contents: client, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'esm', outfile: path.join(out, 'app.js'), define: { 'process.env.NODE_ENV': '"production"', '__DEV__': 'false' }, alias: { '@': app, 'react-native': 'react-native-web', '@slopus/happy-wire': path.join(root, 'packages/happy-wire/dist/index.mjs') }, plugins: [{ name: 'fixture-edges', setup(b) { b.onResolve({ filter: /.*/ }, args => { const key = args.path; if (virtual[key]) return { path: key, namespace: 'fixture' }; }); b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: key }) => ({ contents: virtual[key], loader: 'tsx', resolveDir: path.join(root, 'packages/happy-app') })); } }], resolveExtensions: ['.web.tsx','.tsx','.web.ts','.ts','.web.js','.js','.json'], loader: { '.js': 'jsx' }, banner: { js: 'globalThis.global=globalThis;globalThis.process??={env:{NODE_ENV:"production",EXPO_OS:"web"}};' } });
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://fixture');
        const body = []; for await (const chunk of req) body.push(chunk);
        const input = body.length ? JSON.parse(Buffer.concat(body)) : {};
        res.setHeader('content-type','application/json');
        if (url.pathname === '/app.js') { res.setHeader('content-type','application/javascript');res.end(await readFile(path.join(out,'app.js')));return; }
        if (url.pathname.startsWith('/api/my-agents')) {
            if (req.headers.authorization !== 'Bearer fixture-account-a') {res.statusCode=401;res.end('{}');return;}
            res.end(JSON.stringify(await request(url.pathname.slice('/api/my-agents'.length), { method: req.method, body: JSON.stringify(input) })));return;
        }
        if (url.pathname === '/fixture/skills') {res.end(JSON.stringify(listCodexSkillEntries({cwd:data})));return;}
        if (url.pathname === '/fixture/spawn') {const id='fixture-'+crypto.randomUUID();sessions.set(id,{});res.end(JSON.stringify({type:'success',sessionId:id}));return;}
        if (url.pathname.startsWith('/fixture/session/')) {res.end(JSON.stringify(sessions.get(url.pathname.split('/').at(-1))));return;}
        if (url.pathname === '/fixture/message') {
            let response;
            if (input.myAgentId) response='模拟模型回复：已加载当前 Agent 配置。\n\n'+buildMyAgentPrompt(profiles.get(input.myAgentId));
            else {
                const builder = await invoke('agent_builder', {}); if(builder.isError)throw Error(builder.content[0].text);
                const all=JSON.parse((await invoke('agent_skills',{})).content[0].text).skills;
                const id = input.text.match(/id=(agent-[a-z0-9]+)/)?.[1];const prior=id?profiles.get(id):null;
                const skills=all.filter(s=>s.path.startsWith(data)&&['grilling','show-me'].includes(s.name)).map(s=>({...s,reason:s.name==='grilling'?'挑战复杂决策中的隐含假设':'需要时把比较与流程画清楚'}));
                const result=await invoke('agent_save',{...(prior??{}),name:prior?.name??'狗头军师',summary:'理清想法、挑战假设、依据事实做决策',instructions:id?'先给初步判断，再追问必要的问题。简单问题直接回答。':'挑战隐含假设，比较可行选项，给出明确判断。',skills:prior?.skills??skills,preferences:prior?.preferences??'简洁、直接，指出问题',setupNotes:'',requestId:input.id,...(id?{id,expectedUpdatedAt:prior.updatedAt}:{})});
                if(result.isError)throw Error(result.content[0].text);response='模拟模型调用真实创建工具，保存成功。\n\n'+result.content[0].text;
            }
            sessions.set(input.id,{...input,response});res.end('{}');return;
        }
        res.setHeader('content-type','text/html');res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#app{height:100%;margin:0;background:#241c16;font-family:system-ui}#app{height:calc(100% - 44px);display:flex;flex-direction:column}header{height:44px;box-sizing:border-box;padding:10px 20px;color:#b0a08c;font-size:13px;border-bottom:1px solid #3d3025}</style><header>隔离验收 · 真实页面与保存工具 · 模型/RPC 模拟</header><div id="app"></div><script type="module" src="/app.js"></script>`);
    } catch(error){res.statusCode=error.status??500;res.end(JSON.stringify({error:error.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}/my-agents`,data})));

process.on('SIGTERM', () => server.close(async()=>{await rm(data,{recursive:true,force:true});process.exit(0)}));
