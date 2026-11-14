/** Trusted proxy: no credentials, Docker API or inbound published port. */
import http from 'node:http';
import net from 'node:net';
import {lookup} from 'node:dns/promises';
export function isPublicAddress(value) {
 const address=value.toLowerCase();
 if(net.isIP(address)===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&(p[1]===168||p[1]===0)||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&(p[1]===18||p[1]===19));}
 // Only global-unicast v6, excluding documentation and transition ranges.
 if(net.isIP(address)===6)return /^[23][0-9a-f]{3}:/.test(address)&&!address.startsWith('2001:db8:')&&!address.startsWith('2001:0:')&&!address.startsWith('2002:');
 return false;
}
async function target(hostname,port){
 if(![80,443].includes(port)||!hostname||hostname.includes('%'))throw Error('Destination unavailable');
 const host=hostname.replace(/^\[|\]$/g,'');
 const answers=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await lookup(host,{all:true,verbatim:true});
 if(!answers.length||answers.some(a=>!isPublicAddress(a.address)))throw Error('Destination unavailable');
 return answers[0];
}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url);if(url.protocol!=='http:'||url.username||url.password)throw Error('Unsupported proxy request');
  const port=Number(url.port||80), pinned=await target(url.hostname,port);
  const headers={...req.headers,host:url.host};delete headers['proxy-authorization'];delete headers['proxy-connection'];
  const upstream=http.request({hostname:pinned.address,family:pinned.family,port,path:url.pathname+url.search,method:req.method,headers},reply=>{res.writeHead(reply.statusCode||502,reply.headers);reply.pipe(res);});
  upstream.setTimeout(30000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
 }catch{res.writeHead(403);res.end('Destination unavailable');}
});
server.on('connect',async(req,client,head)=>{
 try{
  const url=new URL('http://'+req.url),port=Number(url.port||443),pinned=await target(url.hostname,port);
  const upstream=net.connect({host:pinned.address,family:pinned.family,port},()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(client);client.pipe(upstream);});
  upstream.setTimeout(60000,()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());
 }catch{client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}
});
if(process.argv[1]?.endsWith('/egress.mjs'))server.listen(3128,'0.0.0.0');
