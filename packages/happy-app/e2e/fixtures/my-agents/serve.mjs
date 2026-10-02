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
const serverEntry = `export { ProfileService } from '${root}/packages/paws-agent-party/src/group-chat/profiles.ts';export { createMyAgentToolHandler } from '${cli}/src/agents/myAgentTools.ts';export { listCodexSkillEntries } from '${cli}/src/codex/codexSkills.ts';export { prepareMyAgentMessage } from '${cli}/src/agents/myAgentCommand.ts';export { buildMyAgentPrompt, parseMyAgentCommand } from '${root}/packages/happy-wire/dist/index.mjs';`;
await build({ stdin: { contents: serverEntry, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', banner: { js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);' }, outfile: path.join(out, 'server.mjs'), alias: { '@': path.join(cli, 'src'), '@slopus/happy-wire': path.join(root, 'packages/happy-wire/dist/index.mjs') }, plugins: [{ name: 'fixture-package-root', setup(b) { b.onResolve({ filter: /^@\/projectPath$/ }, () => ({ path: 'root', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const projectPath=()=>${JSON.stringify(cli)};` })); } }] });
const { ProfileService, createMyAgentToolHandler, listCodexSkillEntries, buildMyAgentPrompt, parseMyAgentCommand, prepareMyAgentMessage } = await import(pathToFileURL(path.join(out, 'server.mjs')));
const profiles = await ProfileService.create(path.join(data, 'account-a'));
const sessions = new Map();
const metadata = { path: data, host: 'fixture', machineId: 'fixture-machine', capabilities: { myAgentCommand: true }, homeDir: data, happyHomeDir: data, happyLibDir: data, happyToolsDir: data, currentModelCode: 'gpt-6.1-sol', currentThoughtLevelCode: 'high' };
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
    '@expo/vector-icons': `export const Ionicons=()=>null;export const Octicons=()=>null;`,
    'expo-router': `import React from'react';const listeners=new Set();window.fixtureNavigate=path=>{history.pushState({},'',path);listeners.forEach(fn=>fn())};window.addEventListener('popstate',()=>listeners.forEach(fn=>fn()));export const useRoute=()=>React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>location.pathname+location.search);export const useLocalSearchParams=()=>{useRoute();return Object.fromEntries(new URLSearchParams(location.search))};const router={push:window.fixtureNavigate,replace:window.fixtureNavigate};router.navigate=window.fixtureNavigate;router.canDismiss=()=>false;router.canGoBack=()=>true;router.back=()=>history.back();export const useNavigation=()=>({dispatch(){}});export const useRouter=()=>router;export const useFocusEffect=fn=>React.useEffect(fn,[fn]);`,
    '@/auth/AuthContext': `const credentials={token:'fixture-account-a'};export const useAuth=()=>({credentials});`,
    '@/auth/accountRuntime': `export const accountRuntimeCurrent=()=>true;export const accountStorageId=id=>'fixture-'+id;`,
    '@/components/agentParty/api': `export const getPartyUrl=()=>'/';`,
    '@/modal': `export const Modal={confirm:async()=>true};`,
    'react-native-mmkv': `export class MMKV{constructor({id}){this.id=id}getString(k){return localStorage.getItem(this.id+k)??undefined}set(k,v){localStorage.setItem(this.id+k,v)}delete(k){localStorage.removeItem(this.id+k)}}`,
    '@/sync/storage': `const state={settings:{recentMachinePaths:[]},sessions:{},applySessions(rows){for(const row of rows)state.sessions[row.id]=row},updateSessionModelMode(){},updateSessionEffortLevel(){},updateSessionPermissionMode(){},updateSessionFastMode(){},sessionMessages:{}};const machines=[{id:'fixture-machine',active:true,activeAt:Date.now(),metadata:{displayName:'隔离测试设备',homeDir:${JSON.stringify(data)}}}];export const storage=Object.assign(fn=>fn(state),{getState:()=>state});export const useAllMachines=()=>machines;const values={agents:[],desktopSkinId:'default',zenMode:false,agentInputEnterToSend:true,agentDefaultOverrides:{},customImageStyles:[],pendingCustomImageStyleReferences:[]};export const useLocalSetting=k=>values[k];export const useSetting=k=>values[k];export const useLocalSettingMutable=k=>[values[k],()=>{}];export const useSettingMutable=k=>[values[k],()=>{}];export const useProfile=()=>({firstName:'Happy'});export const useIsDataReady=()=>true;`,
    '@/sync/skills': `export const scanSkills=async()=>{const r=await fetch('/fixture/skills');return r.json()};`,
    '@/sync/ops': `import{storage}from'@/sync/storage';export const sessionArchive=async()=>{};export const machineListAgentSkills=async()=>{const r=await fetch('/fixture/skills');return r.json()};export const machineSpawnNewSession=async()=>{const result=await(await fetch('/fixture/spawn',{method:'POST'})).json();storage.getState().applySessions([{id:result.sessionId,metadata:{path:${JSON.stringify(data)},host:'fixture',capabilities:{myAgentCommand:true}},metadataVersion:1}]);return result};export const sessionUpdateMetadata=async(id,metadata,version,fn)=>({metadata:fn(metadata),version:version+1});`,
    '@/sync/ensureSessionHydratedWithRetry': `export const ensureSessionHydratedWithRetry=async()=>true;`,
    '@/sync/sync': `import{storage}from'@/sync/storage';export const sync={applySettings(){},sessionRouteBecameInteractive:async()=>{},awaitLocalMessageProjection:async()=>true,checkSessionExists:async()=>true,sendMessage:async(id,text,options={})=>{const row=storage.getState().sessions[id];const r=await fetch('/fixture/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,text,displayText:options.displayText,myAgentId:row?.metadata?.myAgentId})});if(!r.ok)throw Error(await r.text());return{type:'queued',sessionId:id,localIds:['fixture-message']}}};`,
};
Object.assign(virtual, {
    'expo-image': `export{Image}from'react-native';`,
    '@react-navigation/native': `export const DrawerActions={openDrawer:()=>({})};`,
    'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
    'react-native-keyboard-controller': `export{View as KeyboardAvoidingView}from'react-native';`,
    '@/utils/responsive': `export const useIsTablet=()=>window.innerWidth>=800;export const useHeaderHeight=()=>44;export const getDeviceType=()=> 'desktop';`,
    '@/utils/isTauri': `export const isTauri=()=>false;`,
    '@/constants/Typography': `export const Typography={default:()=>({}),display:()=>({}),mono:()=>({})};`,
    '@/text': `import{zhHans}from'${app}/text/translations/zh-Hans';export const t=(key,args)=>{const value=key.split('.').reduce((node,k)=>node?.[k],zhHans);return typeof value==='function'?value(args):value??key};`,
    '@/track': `export const trackSessionSwitched=()=>{};`,
    '@/sync/profile': `export const getDisplayName=()=>'';export const getAvatarUrl=()=>undefined;`,
    '@/sync/firstSubmissionScope': `const scope={key:'fixture-account-a',serverUrl:location.origin};export const getFirstSubmissionScope=()=>scope;`,
    '@/sync/serverConfig': `export const getServerUrl=()=>location.origin;`,
    '@/sync/firstSubmissionRuntime': `import{FirstSubmissionOwner}from'${app}/sync/firstSubmission';import{machineSpawnNewSession}from'@/sync/ops';import{sync}from'@/sync/sync';export const traceFirstSubmissionNavigation=()=>{};export const firstSubmission=new FirstSubmissionOwner({read:scope=>localStorage.getItem('fixture-first:'+scope)??undefined,save:async(scope,value)=>localStorage.setItem('fixture-first:'+scope,value),spawn:input=>machineSpawnNewSession(input),hydrate:async()=>true,configure(){},send:(id,input,live,current)=>sync.sendMessage(id,input.prompt,{attachments:live.images,isCurrent:current}),project:async()=>true,accepted:(_,live)=>live.accepted?.(),metric(){}});firstSubmission.activate('fixture-account-a',()=>true);`,
    '@/hooks/useNewSessionDraft': `import{create}from'zustand';export const useNewSessionDraft=create(set=>({selectedMachineId:'fixture-machine',selectedPath:${JSON.stringify(data)},agentType:'codex',permissionMode:'yolo',modelMode:'gpt-6.1-sol',effortLevel:'high',sessionType:'simple',worktreeKey:null,setAgentType:v=>set({agentType:v}),setMachineId:v=>set({selectedMachineId:v}),setPath:v=>set({selectedPath:v}),setModelMode:v=>set({modelMode:v}),setEffortLevel:v=>set({effortLevel:v})}));`,
    '@/hooks/useSpawnSession': `export const configureSpawnedSession=()=>{};`,
    '@/hooks/useImagePicker': `import{useComposeDraft}from'@/sync/composeDraft';export const useImagePicker=()=>({selectedImages:useComposeDraft(s=>s.images),pickImages(){},pickAttachment(){},removeImage(){},clearImages(){},addImages(){}});`,
    '@/hooks/useDesktopWorkspaceLayout': `export const useDesktopWorkspaceLayout=()=>({leftVisible:false,leftWidth:0,rightPanelAvailable:false,rightExpandedWidth:0,rightWidth:0});`,
    '@/hooks/useGeneratedImagesPlugin': `export const useGeneratedImagesPlugin=()=>({status:{installed:false}});`,
    '@/hooks/useComposerAbortConfirmation': `export const useComposerAbortConfirmation=()=>({requestAbort(){},abortConfirmationVisible:false});`,
    '@/utils/normalizeImageForUpload': `export const normalizeImageForUpload=async x=>x;`,
    '@/utils/thumbhash': `export const generateThumbhash=async()=>undefined;export const thumbhashToDataUri=()=>undefined;`,
    '@/utils/pasteImages.web': `export const getImagesFromClipboard=async()=>[];`,
    './navigation/Header': `export const Header=()=>null;`,
    './ComposeHomeParticles': `export const ComposeHomeParticles=()=>null;`,
    './Avatar': `export const Avatar=()=>null;`,
    './RightSwipePanelHost': `import React from'react';export const RightSwipePanelHost=({children})=><>{children}</>;export const useRightSwipePanel=()=>null;`,
    './rightPanel/SessionCapabilityHub': `export const SessionCapabilityHub=()=>null;`,
    './DesktopRightPanel': `export const DesktopRightPanel=()=>null;export const DesktopRightPanelToggleButton=()=>null;`,
    './DesktopSettingsModal': `export const useDesktopSettingsModal=()=>({openSettings(){}});`,
    './agents/ImageStyleGallerySheet': `export const ImageStyleGallerySheet=()=>null;`,
    './SessionConfigPanel': `import React from'react';import{View,Text}from'react-native';import{useNewSessionDraft}from'@/hooks/useNewSessionDraft';export const SessionConfigPanel=React.forwardRef((p,ref)=>{const draft=useNewSessionDraft();React.useImperativeHandle(ref,()=>({getSelection:()=>draft}));return<View style={{padding:12,gap:6}}><Text style={{color:'#b0a08c'}}>当前项目 · codex · gpt-6.1-sol</Text><Text style={{color:'#b0a08c'}}>{draft.selectedPath}</Text></View>});`,
    './haptics': `export const hapticsLight=()=>{};export const hapticsError=()=>{};`,
    './Shaker': `import React from'react';import{View}from'react-native';export const Shaker=React.forwardRef(({children,style},ref)=><View style={style}>{children}</View>);`,
    './StatusDot': `export const StatusDot=()=>null;`,
    './GitStatusBadge': `export const GitStatusBadge=()=>null;export const useHasMeaningfulGitStatus=()=>false;`,
    './SessionComposerModeSelector': `export const SessionComposerModeSelector=()=>null;`,
    './SessionComposerPermissionSelector': `export const SessionComposerPermissionSelector=()=>null;`,
    './SessionComposerDirectorySelector': `export const SessionComposerDirectorySelector=()=>null;`,
});
const client = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRoute } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { MyAgentsScreen } from '${app}/components/myAgents/MyAgentsScreen';
import { ComposeHome } from '${app}/components/ComposeHome';
import { MessageComposer } from '${app}/components/MessageComposer';
import { MyAgentCard } from '${app}/components/myAgents/MyAgentCard';
import { parseMyAgentCard } from '${app}/utils/sessionMyAgentCard';
import { sync } from '@/sync/sync';
function Chat({ id }) {
    const { theme } = useUnistyles();
    const [data, setData] = React.useState();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const text = React.useRef('');
    const composer = React.useRef();
    const reload = React.useCallback(() => fetch('/fixture/session/' + id).then(r => r.json()).then(setData), [id]);
    React.useEffect(() => { void reload(); }, [reload]);
    const send = async () => {
        if (busy || !text.current.trim()) return;
        setBusy(true); setError('');
        try {
            await sync.sendMessage(id, text.current.trim());
            composer.current?.setTextAndSelection('', { start: 0, end: 0 });
            text.current = '';
            await reload();
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    return <View style={{ flex: 1, width: '100%', maxWidth: 1000, alignSelf: 'center', padding: 24 }}>
        <Text style={{ fontSize: 24, color: theme.colors.text }}>普通会话</Text>
        <Text testID="fixture-session-id" style={{ color: theme.colors.textSecondary }}>{id}</Text>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 16, gap: 16 }}>
            {data?.messages?.map((message, i) => {
                const card = message.response?.match(/<happy-agent>\\s*([\\s\\S]*?)\\s*<\\/happy-agent>/)?.[1];
                return <View key={i} testID={'fixture-message-' + i} style={{ gap: 8 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 16 }}>{message.displayText ?? message.text}</Text>
                    {card ? <MyAgentCard card={parseMyAgentCard(card)}/> : <Text style={{ color: theme.colors.text, fontSize: 16, lineHeight: 26 }}>{message.response}</Text>}
                </View>;
            })}
        </ScrollView>
        {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.warning }}>{error}</Text> : null}
        <MessageComposer ref={composer} mode="session" sessionId={id} initialValue="" placeholder="输入消息…" onChangeText={value => { text.current = value; }} onSend={send} isSending={busy} agentType="codex"/>
    </View>;
}
function App() {
    const route = useRoute();
    const { theme } = useUnistyles();
    return <View style={{ flex: 1 }}><View style={{ flexDirection: 'row', gap: 20, padding: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="普通新对话" onPress={() => window.fixtureNavigate('/new')}><Text style={{ color: theme.colors.text }}>普通新对话</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Agents 列表" onPress={() => window.fixtureNavigate('/my-agents')}><Text style={{ color: theme.colors.text }}>Agents</Text></Pressable>
    </View>{route.startsWith('/session/') ? <Chat key={location.pathname} id={location.pathname.split('/')[2]}/> : route.startsWith('/new') ? <ComposeHome variant="screen"/> : <MyAgentsScreen/>}</View>;
}
createRoot(document.getElementById('app')).render(<App/>);
`;
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
        if (url.pathname === '/fixture/spawn') {const id='fixture-'+crypto.randomUUID();sessions.set(id,{messages:[]});res.end(JSON.stringify({type:'success',sessionId:id}));return;}
        if (url.pathname === '/fixture/state') {res.end(JSON.stringify({sessions:[...sessions.entries()].map(([id,value])=>({id,...value})),agents:profiles.list()}));return;}
        if (url.pathname.startsWith('/fixture/session/')) {res.end(JSON.stringify(sessions.get(url.pathname.split('/').at(-1))));return;}
        if (url.pathname === '/fixture/message') {
            const session = sessions.get(input.id);
            if (!session) throw Error('Unknown synthetic session');
            // Model intent parsing remains an explicit deterministic boundary. The
            // production parser and packaged Skill loader execute before that boundary.
            const command = parseMyAgentCommand(input.text);
            const prepared = prepareMyAgentMessage({ content: { text: input.text } });
            if (prepared && 'error' in prepared) throw Error(prepared.error);
            let response;
            const trace = { command: !!command, builtInSkillLoaded: !!prepared?.prompt?.includes('name: agent-builder'), tools: [] };
            if (command && !command.request) response='想创建或修改什么 Agent？直接告诉我即可。';
            else if (command) {
                const all=JSON.parse((await invoke('agent_skills',{})).content[0].text).skills;
                trace.tools.push('agent_skills');
                const isEdit = /修改|调整/.test(command.request);
                const prior = isEdit ? profiles.list().find(agent=>command.request.includes(agent.name)) : null;
                if (isEdit && !prior) throw Error('No uniquely named fixture Agent to edit');
                const id = prior?.id;
                if (id) { await invoke('agent_get', { id }); trace.tools.push('agent_get'); }
                const skills=all.filter(s=>s.path.startsWith(data)&&['grilling','show-me'].includes(s.name)).map(s=>({...s,reason:s.name==='grilling'?'挑战复杂决策中的隐含假设':'需要时把比较与流程画清楚'}));
                const result=await invoke('agent_save',{...(prior??{}),name:prior?.name??(/叫([^，。\s]+)/.exec(command.request)?.[1]||'狗头军师'),summary:prior?.summary??'理清想法、挑战假设、依据事实做决策',instructions:prior?.instructions??'挑战隐含假设，比较可行选项，给出明确判断。',skills:prior?.skills??skills,preferences:isEdit?'以后回答简短一点': '简洁、直接，指出问题',setupNotes:'',requestId:input.id+'-'+session.messages.length,...(id?{id,expectedUpdatedAt:prior.updatedAt}:{})});
                trace.tools.push('agent_save');
                if(result.isError)throw Error(result.content[0].text);response='模拟模型调用真实保存工具，保存成功。\n\n'+result.content[0].text;
            }
            else if (input.myAgentId) response='模拟模型回复：已加载当前 Agent 配置。\n\n'+buildMyAgentPrompt(profiles.get(input.myAgentId));
            else response='普通回复：继续当前对话。';
            session.messages.push({...input,response,trace});res.end('{}');return;
        }
        res.setHeader('content-type','text/html');res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#app{height:100%;margin:0;background:#241c16;font-family:system-ui}#app{height:calc(100% - 44px);display:flex;flex-direction:column}header{height:44px;box-sizing:border-box;padding:10px 20px;color:#b0a08c;font-size:13px;border-bottom:1px solid #3d3025}</style><header>隔离验收 · 真实页面与保存工具 · 模型/RPC 模拟</header><div id="app"></div><script type="module" src="/app.js"></script>`);
    } catch(error){res.statusCode=error.status??500;res.end(JSON.stringify({error:error.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${port}/my-agents`,data})));

process.on('SIGTERM', () => server.close(async()=>{await rm(data,{recursive:true,force:true});process.exit(0)}));
