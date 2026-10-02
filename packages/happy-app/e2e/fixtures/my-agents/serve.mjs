// Real RN catalog/card, launch coordinator, CLI Skill tools and ProfileService.
// Only auth, machine RPC, encrypted session storage and model responses are fixtures.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
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
const machines = ['a', 'b'].map((key, index) => {
    const home = path.join(data, `machine-${key}`);
    return { id: `fixture-machine-${key}`, active: true, activeAt: Date.now(), metadata: {
        displayName: index ? '测试机器 B（缺少 Skills）' : '测试机器 A', host: `fixture-${key}`, homeDir: home,
        cliAvailability: { codex: true, claude: true, opencode: true, gemini: true },
    }, projects: [path.join(home, 'projects/project-a'), path.join(home, 'projects/project-b')], worktree: path.join(home, 'projects/project-a/.dev/worktree/existing-feature') };
});
for (const machine of machines) for (const dir of [...machine.projects, machine.worktree]) await mkdir(dir, { recursive: true });
const skillFixtures = [
    ['.agents/skills/grilling', 'grilling'], ['.agents/skills/show-me', 'show-me'],
    ['.claude/skills/claude-local', 'claude-local'],
    ['.claude/plugins/cache/fixture-market/fixture-methods/1.0.0/skills/claude-review', 'claude-review'],
];
for (const [relative, name] of skillFixtures) {
    const dir = path.join(machines[0].metadata.homeDir, relative); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: 隔离验收方法\n---\n只处理隔离测试数据。`);
}
const serverEntry = `export { ProfileService } from '${root}/packages/paws-agent-party/src/group-chat/profiles.ts';export { createMyAgentToolHandler } from '${cli}/src/agents/myAgentTools.ts';export { listCodexSkillEntries } from '${cli}/src/codex/codexSkills.ts';export { prepareMyAgentMessage } from '${cli}/src/agents/myAgentCommand.ts';export { buildMyAgentPrompt, parseMyAgentCommand } from '${root}/packages/happy-wire/dist/index.mjs';export {withFixtureHomeDir} from 'fixture-home';`;
await build({ stdin: { contents: serverEntry, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', banner: { js: 'import {createRequire} from "node:module";const require=createRequire(import.meta.url);' }, outfile: path.join(out, 'server.mjs'), alias: { '@': path.join(cli, 'src'), '@slopus/happy-wire': path.join(root, 'packages/happy-wire/dist/index.mjs') }, plugins: [{ name: 'fixture-package-root', setup(b) {
    b.onResolve({ filter: /^@\/projectPath$/ }, () => ({ path: 'root', namespace: 'fixture' }));
    b.onResolve({ filter: /^fixture-home$/ }, () => ({ path: 'home', namespace: 'fixture' }));
    b.onResolve({ filter: /^node:os$/ }, args => args.importer.endsWith('/codexSkills.ts') ? { path: 'scanner-os', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: key }) => ({ contents: key === 'root' ? `export const projectPath=()=>${JSON.stringify(cli)};`
        : key === 'home' ? `import {AsyncLocalStorage} from 'node:async_hooks';const homes=new AsyncLocalStorage();export const withFixtureHomeDir=(home,fn)=>homes.run(home,fn);export const fixtureHomeDir=()=>homes.getStore()??${JSON.stringify(machines[0].metadata.homeDir)};`
        : `import os from 'node:os';import {fixtureHomeDir} from 'fixture-home';export default {...os,homedir:fixtureHomeDir};` }));
} }] });
const { ProfileService, createMyAgentToolHandler, listCodexSkillEntries, buildMyAgentPrompt, parseMyAgentCommand, prepareMyAgentMessage, withFixtureHomeDir } = await import(pathToFileURL(path.join(out, 'server.mjs')));
const profiles = await ProfileService.create(path.join(data, 'account-a'));
const sessions = new Map();
const metadataFor = (machine, directory, agent = 'codex') => ({ path: directory, host: machine.metadata.host, machineId: machine.id, flavor: agent, capabilities: { myAgentCommand: true }, homeDir: machine.metadata.homeDir, happyHomeDir: data, happyLibDir: cli, happyToolsDir: data, currentModelCode: 'gpt-6.1-sol', currentThoughtLevelCode: 'high' });
const scans = [];
const launches = [];
const request = async (suffix, init) => {
    const input = init?.body ? JSON.parse(init.body) : {};
    if (!suffix) return init?.method === 'POST' ? profiles.saveMyAgent(input) : { agents: profiles.list() };
    const [id, operation] = suffix.slice(1).split('/');
    if (operation === 'sessions') return profiles.recordSession(id, input);
    if (operation === 'archive') return profiles.archiveMyAgent(id, input);
    return init?.method === 'PATCH' ? profiles.saveMyAgent(input, id) : profiles.get(id);
};
const invokeFor = metadata => {
    const machine = machines.find(item => item.id === metadata.machineId);
    if (!machine) throw Error('Unknown fixture machine');
    const handler = createMyAgentToolHandler({ getMetadata: () => metadata, requestMyAgents: request });
    return (name, args) => withFixtureHomeDir(machine.metadata.homeDir, () => handler(name, args));
};
const seedMetadata = metadataFor(machines[0], machines[0].projects[0]);
const seedInvoke = invokeFor(seedMetadata);
const configSeed = await seedInvoke('agent_save', { name: '配置验证助手', summary: '测试当前设备、项目、模型和已有 worktree', instructions: '只处理隔离测试任务。', skills: [], requestId: 'fixture-config-seed' });
if (configSeed.isError) throw Error(configSeed.content[0].text);
const claudeSkills = withFixtureHomeDir(machines[0].metadata.homeDir, () => listCodexSkillEntries({ cwd: machines[0].projects[0] }))
    .filter(skill => skill.path.includes('/.claude/')).map(skill => ({ ...skill, reason: '验证 Claude 安装来源的真实 Skill' }));
if (claudeSkills.length !== 2) throw Error('Shared scanner must discover the two isolated Claude Skills before this fixture can run');
const skillsSeed = await seedInvoke('agent_save', { name: 'Claude Skills 助手', summary: '绑定 .claude/skills 和 .claude/plugins 中的两个方法', instructions: '只处理隔离测试任务。', skills: claudeSkills, requestId: 'fixture-claude-skills-seed' });
if (skillsSeed.isError) throw Error(skillsSeed.content[0].text);
const fixtureHistory = machines.flatMap(machine => [...machine.projects, machine.worktree].map((directory, index) => ({
    id: `history-${machine.id}-${index}`, activeAt: Date.now() - index, createdAt: Date.now() - index, updatedAt: Date.now(), metadataVersion: 1,
    metadata: { ...metadataFor(machine, directory), models: [{ code: 'gpt-6.1-sol', value: 'gpt-6.1-sol' }, { code: 'gpt-6-astra', value: 'gpt-6-astra' }] },
})));
const virtual = {
    'react-native-unistyles': `import{appThemes}from'${app}/themePacks';const theme=appThemes.ginghamDark;export const StyleSheet={create:f=>typeof f==='function'?f(theme,{insets:{top:0,bottom:0}}):f,hairlineWidth:1};export const useUnistyles=()=>({theme});`,
    '@expo/vector-icons': `export const Ionicons=()=>null;export const Octicons=()=>null;export const MaterialCommunityIcons=()=>null;`,
    'expo-glass-effect': `export {View as GlassView} from 'react-native';`,
    'expo-router': `import React from'react';const listeners=new Set();window.fixtureNavigate=path=>{history.pushState({},'',path);listeners.forEach(fn=>fn())};window.addEventListener('popstate',()=>listeners.forEach(fn=>fn()));export const useRoute=()=>React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>location.pathname+location.search);export const useLocalSearchParams=()=>{useRoute();return Object.fromEntries(new URLSearchParams(location.search))};const router={push:window.fixtureNavigate,replace:window.fixtureNavigate};router.navigate=window.fixtureNavigate;router.canDismiss=()=>false;router.canGoBack=()=>true;router.back=()=>history.back();export const useNavigation=()=>({dispatch(){}});export const useRouter=()=>router;export const useFocusEffect=fn=>React.useEffect(fn,[fn]);`,
    '@/auth/AuthContext': `const credentials={token:'fixture-account-a'};export const useAuth=()=>({credentials});`,
    '@/auth/accountRuntime': `export const accountRuntimeCurrent=()=>true;export const accountStorageId=id=>'fixture-'+id;`,
    '@/components/agentParty/api': `export const getPartyUrl=()=>'/';`,
    '@/modal': `export const Modal={confirm:async()=>true,alert:(title,message)=>window.alert(title+'\\n'+message)};`,
    'react-native-mmkv': `export class MMKV{constructor({id}={}){this.id=id??'fixture'}getString(k){return localStorage.getItem(this.id+k)??undefined}getBoolean(k){const v=this.getString(k);return v===undefined?undefined:v==='true'}getNumber(k){const v=this.getString(k);return v===undefined?undefined:Number(v)}set(k,v){localStorage.setItem(this.id+k,v)}delete(k){localStorage.removeItem(this.id+k)}}`,
    '@/sync/storage': `import{create}from'zustand';const machines=${JSON.stringify(machines)};const history=${JSON.stringify(fixtureHistory)};const values={agents:[],desktopSkinId:'default',zenMode:false,agentInputEnterToSend:true,agentDefaultOverrides:{},customImageStyles:[],pendingCustomImageStyleReferences:[],recentMachinePaths:machines.flatMap(m=>m.projects.map(path=>({machineId:m.id,path})))};export const storage=create((set,get)=>({settings:values,sessions:Object.fromEntries(history.map(s=>[s.id,s])),sessionList:history,sessionMessages:{},applySessions(rows){const sessions={...get().sessions};for(const row of rows)sessions[row.id]=row;set({sessions,sessionList:Object.values(sessions)})},updateSessionModelMode(id,value){get().applySessions([{...get().sessions[id],modelMode:value}])},updateSessionEffortLevel(id,value){get().applySessions([{...get().sessions[id],effortLevel:value}])},updateSessionPermissionMode(id,value){get().applySessions([{...get().sessions[id],permissionMode:value}])},updateSessionFastMode(id,value){get().applySessions([{...get().sessions[id],fastMode:value}])}}));export const useAllMachines=()=>machines;export const useSessions=()=>storage(s=>s.sessionList);export const useLocalSetting=k=>values[k];export const useSetting=k=>values[k];export const useLocalSettingMutable=k=>[values[k],()=>{}];export const useSettingMutable=k=>[values[k],()=>{}];export const useProfile=()=>({firstName:'Happy'});export const useIsDataReady=()=>true;`,
    '@/sync/skills': `export const scanSkills=async(machineId,cwd)=>{const r=await fetch('/fixture/skills?'+new URLSearchParams({machineId:machineId??'fixture-machine-a',cwd:cwd??''}));return r.json()};`,
    '@/sync/ops': `import{storage}from'@/sync/storage';const post=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw Error(value.error??'Fixture RPC failed');return value};export const sessionArchive=async()=>{};export const machineListAgentSkills=(machineId,cwd)=>post('/fixture/skills',{machineId,cwd});export const machineBrowseDirectory=(machineId,path)=>post('/fixture/browse',{machineId,path});export const machineBash=(machineId,args)=>post('/fixture/bash',{machineId,...args});export const machineSpawnNewSession=async(args)=>{const result=await post('/fixture/spawn',args);storage.getState().applySessions([result.session]);return{type:result.type,sessionId:result.sessionId}};export const sessionUpdateMetadata=async(id,metadata,version,fn)=>({metadata:fn(metadata),version:version+1});`,
    '@/sync/ensureSessionHydratedWithRetry': `export const ensureSessionHydratedWithRetry=async()=>true;`,
    '@/sync/sync': `import{storage}from'@/sync/storage';export const sync={applySettings(){},sessionRouteBecameInteractive:async()=>{},awaitLocalMessageProjection:async()=>true,checkSessionExists:async()=>true,sendMessage:async(id,text,options={})=>{const row=storage.getState().sessions[id];const r=await fetch('/fixture/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,text,displayText:options.displayText,myAgentId:row?.metadata?.myAgentId,metadata:row?.metadata,configuration:row?.fixtureConfiguration,mode:{model:row?.modelMode,effort:row?.effortLevel,permission:row?.permissionMode,fast:row?.fastMode}})});if(!r.ok)throw Error(await r.text());return{type:'queued',sessionId:id,localIds:['fixture-message']}}};`,
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
    '@/sync/firstSubmissionRuntime': `import{FirstSubmissionOwner}from'${app}/sync/firstSubmission';import{machineSpawnNewSession}from'@/sync/ops';import{sync}from'@/sync/sync';import{configureSpawnedSession}from'@/hooks/useSpawnSession';export const traceFirstSubmissionNavigation=()=>{};export const firstSubmission=new FirstSubmissionOwner({read:scope=>localStorage.getItem('fixture-first:'+scope)??undefined,save:async(scope,value)=>localStorage.setItem('fixture-first:'+scope,value),spawn:(input,live)=>machineSpawnNewSession({machineId:input.machineId,directory:live.directory,agent:input.agent}),hydrate:async()=>true,configure:configureSpawnedSession,send:(id,input,live,current)=>sync.sendMessage(id,input.prompt,{attachments:live.images,isCurrent:current}),project:async()=>true,accepted:(_,live)=>live.accepted?.(),metric(){}});firstSubmission.activate('fixture-account-a',()=>true);`,
    '@/hooks/useNewSessionDraft': `import{create}from'zustand';export const useNewSessionDraft=create(set=>({input:'',selectedMachineId:'fixture-machine-a',selectedPath:${JSON.stringify(machines[0].projects[0])},agentType:'codex',permissionMode:'yolo',modelMode:'gpt-6.1-sol',effortLevel:'high',sessionType:'simple',worktreeKey:null,setInput:v=>set({input:v}),setAgentType:v=>set({agentType:v}),setMachineId:v=>set({selectedMachineId:v,selectedPath:null,worktreeKey:null}),setPath:v=>set({selectedPath:v,worktreeKey:null}),setModelMode:v=>set({modelMode:v}),setEffortLevel:v=>set({effortLevel:v}),setPermissionMode:v=>set({permissionMode:v}),setSessionType:v=>set({sessionType:v}),setWorktreeKey:v=>set({worktreeKey:v})}));`,
    '@/hooks/useSpawnSession': `import{storage}from'@/sync/storage';export const configureSpawnedSession=(id,args)=>{const s=storage.getState();s.applySessions([{...s.sessions[id],fixtureConfiguration:{permissionMode:args.permissionMode,modelMode:args.modelMode,effortLevel:args.effortLevel,fastMode:args.fastMode}}]);for(const[key,method]of[['permissionMode','updateSessionPermissionMode'],['modelMode','updateSessionModelMode'],['effortLevel','updateSessionEffortLevel'],['fastMode','updateSessionFastMode']])if(args[key]!==undefined)storage.getState()[method](id,args[key])};`,
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
    './haptics': `export const hapticsLight=()=>{};export const hapticsError=()=>{};`,
    './Shaker': `import React from'react';import{View}from'react-native';export const Shaker=React.forwardRef(({children,style},ref)=><View style={style}>{children}</View>);`,
    './StatusDot': `export const StatusDot=()=>null;`,
    './GitStatusBadge': `export const GitStatusBadge=()=>null;export const useHasMeaningfulGitStatus=()=>false;`,
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
import { SessionConfigPanel } from '${app}/components/SessionConfigPanel';
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
        <Pressable accessibilityRole="button" accessibilityLabel="测试：完整配置面板" onPress={() => window.fixtureNavigate('/fixture/config')}><Text style={{ color: theme.colors.text }}>测试：完整配置面板</Text></Pressable>
    </View>{route.startsWith('/session/') ? <Chat key={location.pathname} id={location.pathname.split('/')[2]}/> : route.startsWith('/new') ? <ComposeHome variant="screen"/> : route.startsWith('/fixture/config') ? <ScrollView><SessionConfigPanel layout="inline" collapsible={false}/></ScrollView> : <MyAgentsScreen/>}</View>;
}
createRoot(document.getElementById('app')).render(<App/>);
`;
await build({ stdin: { contents: client, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'esm', outfile: path.join(out, 'app.js'), define: { 'process.env.NODE_ENV': '"production"', '__DEV__': 'false' }, alias: { '@': app, 'react-native': 'react-native-web', '@slopus/happy-wire': path.join(root, 'packages/happy-wire/dist/index.mjs') }, plugins: [{ name: 'fixture-edges', setup(b) { b.onResolve({ filter: /.*/ }, args => { const key = args.path; if (virtual[key]) return { path: key, namespace: 'fixture' }; }); b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: key }) => ({ contents: virtual[key], loader: 'tsx', resolveDir: path.join(root, 'packages/happy-app') })); } }], resolveExtensions: ['.web.tsx','.tsx','.web.ts','.ts','.web.js','.js','.json'], loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl' }, banner: { js: 'globalThis.global=globalThis;globalThis.process??={env:{NODE_ENV:"production",EXPO_OS:"web"}};' } });
const requireMachine = id => {
    const machine = machines.find(item => item.id === id);
    if (!machine) throw Error('Unknown fixture machine');
    return machine;
};
const fixtureDirectory = (machine, value) => {
    const home = machine.metadata.homeDir;
    const directory = path.resolve(!value || value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value);
    if (directory !== home && !directory.startsWith(home + path.sep)) throw Error('Fixture path is outside the selected machine home');
    return directory;
};
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
        if (url.pathname === '/fixture/skills') {
            const machine = requireMachine(input.machineId ?? url.searchParams.get('machineId') ?? machines[0].id);
            const directory = fixtureDirectory(machine, input.cwd ?? url.searchParams.get('cwd'));
            const skills = withFixtureHomeDir(machine.metadata.homeDir, () => listCodexSkillEntries({ cwd: directory }));
            scans.push({ machineId: machine.id, directory, skills }); res.end(JSON.stringify(skills)); return;
        }
        if (url.pathname === '/fixture/browse') {
            const machine = requireMachine(input.machineId); const directory = fixtureDirectory(machine, input.path);
            const entries = await readdir(directory, { withFileTypes: true });
            res.end(JSON.stringify({ success: true, path: directory, home: machine.metadata.homeDir, parent: path.dirname(directory), directories: entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => ({ name: entry.name, path: path.join(directory, entry.name) })) })); return;
        }
        if (url.pathname === '/fixture/bash') {
            const machine = requireMachine(input.machineId); const directory = fixtureDirectory(machine, input.cwd);
            if (input.command !== 'git worktree list --porcelain') throw Error('Only synthetic worktree listing is supported');
            const stdout = `worktree ${directory}\nHEAD fixture\nbranch refs/heads/main\n\n` + (directory === machine.projects[0] ? `worktree ${machine.worktree}\nHEAD fixture\nbranch refs/heads/existing-feature\n\n` : '');
            res.end(JSON.stringify({ success: true, exitCode: 0, stdout, stderr: '' })); return;
        }
        if (url.pathname === '/fixture/spawn') {
            const machine = requireMachine(input.machineId); const directory = fixtureDirectory(machine, input.directory);
            if (typeof input.agent !== 'string') throw Error('Spawn must include the selected engine');
            const id='fixture-'+crypto.randomUUID();const metadata=metadataFor(machine,directory,input.agent);
            const launch={sessionId:id,request:{...input},machineId:machine.id,directory,engine:input.agent,model:null};launches.push(launch);
            sessions.set(id,{messages:[],metadata,launch});
            res.end(JSON.stringify({type:'success',sessionId:id,session:{id,metadata,metadataVersion:1,active:true,activeAt:Date.now(),createdAt:Date.now(),updatedAt:Date.now()}}));return;
        }
        if (url.pathname === '/fixture/state') {res.end(JSON.stringify({machines,scans,launches,sessions:[...sessions.entries()].map(([id,value])=>({id,...value})),agents:profiles.list()}));return;}
        if (url.pathname.startsWith('/fixture/session/')) {res.end(JSON.stringify(sessions.get(url.pathname.split('/').at(-1))));return;}
        if (url.pathname === '/fixture/message') {
            const session = sessions.get(input.id);
            if (!session) throw Error('Unknown synthetic session');
            session.configuration = input.configuration;
            session.mode = input.mode;
            session.launch.model = input.mode?.model ?? input.configuration?.modelMode ?? null;
            // Metadata is derived from the real spawn arguments. The simulated
            // message transport may add the role and selected model, never replace
            // the machine, project or engine with a fixture-wide default.
            session.metadata = { ...session.metadata, ...(input.myAgentId ? { myAgentId: input.myAgentId } : {}),
                ...(session.launch.model ? { currentModelCode: session.launch.model } : {}),
                ...(input.mode?.effort ? { currentThoughtLevelCode: input.mode.effort } : {}) };
            const invoke = invokeFor(session.metadata);
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
                const skills=all.filter(s=>s.path.startsWith(data)&&(command.request.includes('Claude') ? s.path.includes('/.claude/') : ['grilling','show-me'].includes(s.name))).map(s=>({...s,reason:s.name==='grilling'?'挑战复杂决策中的隐含假设':'在合适任务中使用此方法'}));
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
