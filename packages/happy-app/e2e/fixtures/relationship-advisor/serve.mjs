// Isolated visual regression harness. Real screen, hook, cache, transport client,
// server handler and provider adapter; fixture composer and deterministic upstream.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const app = path.join(root, 'packages/happy-app/sources');
const out = path.join(root, 'test-results/advisor-context');
await mkdir(out, { recursive: true });
const baseline = process.env.ADVISOR_BASELINE ?? '9c1539a1';
const port = Number(process.env.ADVISOR_FIXTURE_PORT ?? 18764);
const variants = new Map();

function baselinePlugin(before) {
    return { name: 'baseline', setup(b) {
        if (!before) return;
        b.onLoad({ filter: /packages\/happy-(?:app|server)\/sources\/.*\.tsx?$/ }, async ({ path: filename }) => {
            const relative = path.relative(root, filename);
            try { return { contents: execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8' }), loader: filename.endsWith('tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(filename) }; }
            catch { return undefined; }
        });
    } };
}

for (const variant of ['before', 'after']) {
    const before = variant === 'before';
    const serverEntry = `
      export { relationshipAdvisorHandler } from '${root}/packages/happy-server/sources/app/api/socket/relationshipAdvisorHandler.ts';
      export { streamRelationshipAdvisor } from '${root}/packages/happy-server/sources/modules/relationship-advisor/relationshipAdvisorClient.ts';
    `;
    const serverFile = path.join(out, `${variant}-server.mjs`);
    await build({ stdin: { contents: serverEntry, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: serverFile,
        plugins: [{ name: 'server-edges', setup(b) {
            b.onResolve({ filter: /^@\/modules\/relationship-advisor\/relationshipAdvisor(?:Plugin|Images)$/ }, ({ path: name }) => ({ path: name, namespace: 'stub' }));
            b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const relationshipAdvisorPlugin = {}; export const deleteRelationshipAdvisorImages = () => {}; export const resolveRelationshipAdvisorImageUrls = () => {};', loader: 'js' }));
        } }, baselinePlugin(before)],
        alias: { '@': path.join(root, 'packages/happy-server/sources') },
    });
    variants.set(variant, await import(pathToFileURL(serverFile).href));

    const virtual = {
        'expo-crypto': `export const randomUUID = () => crypto.randomUUID();`,
        'expo-router': `export const Stack = { Screen: () => null }; export const useLocalSearchParams=()=>({conversationId:'fixture'}); const router={setParams(){},replace(){}}; export const useRouter=()=>router;`,
        'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0});`,
        'react-native-keyboard-controller': `export { View as KeyboardAvoidingView } from 'react-native-web';`,
        '@expo/vector-icons': `import React from 'react'; export const Ionicons=({name})=><span aria-hidden="true">{name.includes('image')?'▧':name.includes('stop')?'■':'◇'}</span>;`,
        'react-native-unistyles': `const theme={colors:{surface:'#241c16',surfaceSelected:'#372c21',surfacePressed:'#45372a',text:'#eadfd1',textSecondary:'#b0a08c',divider:'#3d3025',header:{tint:'#eadfd1'}}};export const StyleSheet={create:f=>f(theme),hairlineWidth:1};export const useUnistyles=()=>({theme});`,
        '@/components/layout': `export const layout={maxWidth:1100};`,
        '@/constants/Typography': `export const Typography={default:()=>({fontFamily:'system-ui'})};`,
        '@/modal': `export const Modal={confirm:async()=>true};`,
        '@/hooks/useRelationshipAdvisorPlugin': `export const useRelationshipAdvisorPlugin=()=>({status:{installed:true}});`,
        '@/components/markdown/MarkdownView': `import React from 'react';import {Text} from 'react-native-web';export const MarkdownView=({markdown})=><Text style={{fontSize:16,lineHeight:25,color:'#eadfd1'}}>{markdown}</Text>;`,
        '@/text': `const s={'relationshipAdvisor.title':'狗头军师','relationshipAdvisor.placeholder':'输入追问…','relationshipAdvisor.imageCount':({count})=>count+' 张图片','relationshipAdvisor.emptyResponse':'模型没有返回内容，请重试。','relationshipAdvisor.unavailable':'暂时无法连接，请稍后重试。','relationshipAdvisor.emptyPrompt':'发送截图，一起分析。','common.retry':'重试','relationshipAdvisor.stopAccessibility':'停止生成','relationshipAdvisor.clearAccessibility':'清空会话'}; export const t=(key,args)=>typeof s[key]==='function'?s[key](args):s[key]??key;`,
        '@/sync/storage': `import React from 'react';
          const key='advisor-fixture-${variant}'; let conversations=JSON.parse(localStorage.getItem(key)??'null')??[{id:'fixture',title:'回归测试',createdAt:1,updatedAt:1,messages:[]}];const listeners=new Set();
          const update=fn=>{conversations=fn(conversations);localStorage.setItem(key,JSON.stringify(conversations));listeners.forEach(f=>f());};
          export const useLocalSetting=()=>React.useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>conversations);
          export const useLocalSettingUpdater=()=>update;
          window.fixtureHistory=()=>conversations;
        `,
        '@/hooks/useImagePicker': `import React from 'react';export function useImagePicker(){const [selectedImages,setImages]=React.useState([]);return{selectedImages,pickImages(){},removeImage:id=>setImages(a=>a.filter(x=>x.id!==id)),clearImages:()=>setImages([]),addImages:xs=>setImages(a=>[...a,...xs])}}`,
        '@/components/MessageComposer': `import React from 'react';import {View,Text,TextInput,Pressable} from 'react-native-web';export const MessageComposer=React.forwardRef((p,ref)=>{const [value,setValue]=React.useState('');React.useImperativeHandle(ref,()=>({setTextAndSelection:x=>setValue(x)}));return <View style={{padding:16,gap:12}}><View style={{flexDirection:'row',gap:12,alignItems:'center'}}><input aria-label="选择测试图片" type="file" accept="image/*" onChange={e=>{const f=e.target.files[0];if(f)p.onAddImages([{id:crypto.randomUUID(),uri:URL.createObjectURL(f),width:16,height:16,mimeType:f.type,size:f.size,name:f.name}])}}/><Text style={{color:'#b0a08c'}}>{p.selectedImages?.length??0} 张待发送</Text>{p.leadingControls}</View><View style={{flexDirection:'row',gap:12}}><TextInput testID="fixture-input" style={{flex:1,color:'#eadfd1',backgroundColor:'#372c21',padding:14,fontSize:16,borderRadius:8}} value={value} onChangeText={x=>{setValue(x);p.onChangeText(x)}} placeholder={p.placeholder}/><Pressable testID="fixture-send" accessibilityRole="button" disabled={p.isSendDisabled} onPress={p.onSend} style={{padding:14,backgroundColor:'#5c4936',borderRadius:8}}><Text style={{color:'#fff'}}>发送</Text></Pressable></View></View>});`,
        '@/auth/tokenStorage': `export const TokenStorage={getCredentials:async()=>({token:'fixture-only',secret:'fixture-only'})};`,
        '@/sync/apiAttachments': `export const uploadEncryptedBlob=async(upload,bytes)=>{const response=await fetch(upload.uploadUrl,{method:'PUT',body:bytes});if(!response.ok)throw Error('upload failed')};`,
        '@/sync/apiSocket': `const listeners=new Set();const statuses=new Set(); export const apiSocket={
          request:(url,init)=>fetch('/${variant}'+url,init),
          onMessage:(name,fn)=>{listeners.add(fn);return()=>listeners.delete(fn)},
          onStatusChange:fn=>{fn('connected');return()=>{}},
          emitWithAck:async(name,request)=>{const response=await fetch('/${variant}/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...request,fixtureMode:window.fixtureMode??'normal'})});const result=await response.json();window.lastFixtureRequest=result.evidence;for(const event of result.events)listeners.forEach(fn=>fn(event));return result.ack},
          send:()=>true};
        `,
    };
    const clientEntry = `import React from 'react';import{createRoot}from'react-dom/client';import Screen from '${app}/app/(app)/relationship-advisor.tsx';createRoot(document.getElementById('app')).render(<Screen/>);`;
    await build({ stdin: { contents: clientEntry, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'browser', format: 'esm', outfile: path.join(out, `${variant}.js`), define: { 'process.env.NODE_ENV': '"production"', '__DEV__': 'false' },
        plugins: [{ name: 'browser-edges', setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
                let name=args.path;
                if(name.startsWith('.') && args.resolveDir===path.join(app,'sync')) name='@/sync/'+path.basename(name);
                if(virtual[name])return{path:name,namespace:'fixture'};
                if(/relationshipAdvisorImageCache$/.test(name))return{path:path.join(app,'sync/relationshipAdvisorImageCache.web.ts')};
                if(name==='@/utils/readFileBytes')return{path:path.join(app,'utils/readFileBytes.web.ts')};
            });
            b.onLoad({ filter: /.*/,namespace:'fixture' }, ({path:name})=>({contents:virtual[name],loader:'tsx',resolveDir:root}));
        } }, baselinePlugin(before)], alias: { '@': app, 'react-native': 'react-native-web' },
    });
}

const uploads = new Map();
const server = createServer(async(req,res)=>{
    try {
        const [variant, ...parts] = new URL(req.url,'http://fixture').pathname.slice(1).split('/');
        const suffix='/'+parts.join('/');
        if(!variants.has(variant)){res.writeHead(404);res.end();return}
        if(suffix==='/app.js'){res.setHeader('content-type','application/javascript');res.end(await readFile(path.join(out,`${variant}.js`)));return}
        if(req.method==='GET'){
            res.setHeader('content-type','text/html');res.end(`<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0;background:#241c16;color:#eadfd1;font-family:system-ui}#app{height:calc(100% - 64px);display:flex;flex-direction:column}header{height:64px;box-sizing:border-box;padding:18px 24px;border-bottom:1px solid #3d3025;display:flex;justify-content:space-between}small{color:#b0a08c}</style><header><strong>狗头军师 · ${variant==='before'?'修复前':'修复后'}</strong><small>隔离回归夹具 · 实际聊天页/消息链路 · 模型响应模拟</small></header><div id="app"></div><script type="module" src="/${variant}/app.js"></script>`);return;
        }
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
        res.setHeader('content-type','application/json');
        if(suffix==='/v1/relationship-advisor/images/request-upload'){
            const ref='advisor/fixture/'+crypto.randomUUID()+'.png';res.end(JSON.stringify({ref,uploadUrl:`http://127.0.0.1:${port}/${variant}/upload/${ref}`,method:'PUT'}));return;
        }
        if(suffix.startsWith('/upload/')){uploads.set(suffix.slice(8),bytes);res.end('{}');return}
        if(suffix==='/v1/relationship-advisor/images'){for(const ref of JSON.parse(bytes).refs)uploads.delete(ref);res.end('{}');return}
        if(suffix==='/turn'){
            const request=JSON.parse(bytes);const events=[];let ack;let evidence;
            const listeners=new Map();let finish;const done=new Promise(resolve=>{finish=resolve});
            const socket={on(name,fn){listeners.set(name,fn)},emit(_name,data){events.push(data);if(data.type==='done'||data.type==='error')finish()}};
            const {relationshipAdvisorHandler,streamRelationshipAdvisor}=variants.get(variant);
            relationshipAdvisorHandler('fixture',socket,{
                openRuntime:async()=>({apiKey:'fixture',baseUrl:'https://fixture.invalid/v1',model:'fixture'}),
                resolveImageUrls:async(_user,refs)=>refs.map(ref=>{const image=uploads.get(ref);if(!image)throw Error('Missing upload');return 'data:image/png;base64,'+image.toString('base64')}),
                deleteImageRefs:async(_user,refs)=>{refs.forEach(ref=>uploads.delete(ref))},
                streamChat:(input,config)=>streamRelationshipAdvisor(input,{...config,validateBaseUrl:async url=>url,fetchImpl:async(_url,init)=>{
                    const body=JSON.parse(init.body);const images=body.messages.flatMap((m,i)=>Array.isArray(m.content)?m.content.filter(p=>p.type==='image_url').map(p=>({message:i,bytes:Buffer.from(p.image_url.url.split(',')[1],'base64').length})):[]);
                    evidence={imageCount:images.length,images,userMessages:body.messages.filter(m=>m.role==='user').length};
                    const text=images.length?'已收到原图。图片字节已随原消息再次传入，可以继续分析截图。':'这次请求里没有图片，请重新发送截图。';
                    return new Response(request.fixtureMode==='empty'?'data: [DONE]\n\n':'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n');
                }}),
            });
            listeners.get('relationship-advisor:start')(request,result=>{ack=result;if(!result.ok)finish()});
            await done;res.end(JSON.stringify({events,ack,evidence}));return;
        }
        res.writeHead(404);res.end('{}');
    }catch(error){res.writeHead(500);res.end(JSON.stringify({error:String(error)}))}
});
server.listen(port,'127.0.0.1',()=>console.log(`Advisor fixture ready: http://127.0.0.1:${port}/before/ and /after/`));
