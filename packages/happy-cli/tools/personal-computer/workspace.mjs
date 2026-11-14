import fs from 'node:fs/promises';
import path from 'node:path';
let text=''; for await (const chunk of process.stdin) { text+=chunk; if(Buffer.byteLength(text)>400000)throw Error('Request too large'); }
const request=JSON.parse(text), root='/workspace';
if(typeof request.path!=='string'||request.path.includes('\0'))throw Error('Invalid workspace path');
const lexical=path.resolve(root,request.path);
const inside=value=>value===root||value.startsWith(root+'/');
if(!inside(lexical))throw Error('Path leaves workspace');
if(/(?:^|\/)(?:\.env(?:\.[^/]+)?|\.ssh|access\.key|agent\.key|auth\.json)(?:$|\/)/i.test(lexical))throw Error('Credential path is unavailable');
if(request.action==='read') {
 const actual=await fs.realpath(lexical); if(!inside(actual))throw Error('Symlink leaves workspace');
 const info=await fs.stat(actual);if(!info.isFile()||info.size>262144)throw Error('File is not a bounded text file');
 process.stdout.write(JSON.stringify({content:await fs.readFile(actual,'utf8')}));
} else if(request.action==='write') {
 if(typeof request.content!=='string'||Buffer.byteLength(request.content)>262144)throw Error('Content too large');
 // Traverse each directory without following symlinks. Each file operation is
 // an isolated task container; no other agent command runs concurrently.
 const parent=path.dirname(lexical), segments=path.relative(root,parent).split('/').filter(Boolean);
 let current=root;
 for(const segment of segments){current=path.join(current,segment);try{await fs.mkdir(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const st=await fs.lstat(current);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Output directory is not a real directory');}
 const handle=await fs.open(lexical,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);
 try{await handle.writeFile(request.content);}finally{await handle.close();}
 process.stdout.write(JSON.stringify({written:lexical}));
} else throw Error('Unknown workspace action');
