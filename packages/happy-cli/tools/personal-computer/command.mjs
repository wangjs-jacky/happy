import {spawn} from 'node:child_process';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>20000)throw Error('Command too large');}
const {command}=JSON.parse(input);if(typeof command!=='string'||!command||command.length>12000)throw Error('Invalid command');
const child=spawn('/bin/sh',['-lc',command],{cwd:'/workspace',stdio:['ignore','pipe','pipe']});
let stdout='',stderr='',bytes=0,limited=false;
function read(kind,chunk){bytes+=chunk.length;if(bytes>262144){limited=true;child.kill('SIGKILL');return;}if(kind==='out')stdout+=chunk;else stderr+=chunk;}
child.stdout.on('data',c=>read('out',c));child.stderr.on('data',c=>read('err',c));
const timer=setTimeout(()=>{limited=true;child.kill('SIGKILL');},60000);
child.on('error',error=>{clearTimeout(timer);process.stdout.write(JSON.stringify({stdout,stderr:error.message,exitCode:1}));});
child.on('close',(code,signal)=>{clearTimeout(timer);process.stdout.write(JSON.stringify({stdout:stdout.slice(0,16000),stderr:stderr.slice(0,16000),exitCode:code??1,...(limited?{error:'Command exceeded its time or output limit'}:{}),...(signal?{signal}:{})}));});
