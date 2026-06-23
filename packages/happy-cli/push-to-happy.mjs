#!/usr/bin/env node
/**
 * push-to-happy.mjs —— 把已有的 Claude Code 会话(.jsonl)加密推送到
 * 自托管 Happy 中继服务器,使其在 Happy 客户端(手机/网页)里可见。
 *
 * 单个:
 *   node push-to-happy.mjs <session-id 或 .jsonl 路径> [选项]
 * 批量:
 *   node push-to-happy.mjs --all                 # 推 ~/.claude/projects 下所有会话
 *   node push-to-happy.mjs --project <目录名>     # 只推某个项目(projects 下的哈希目录名)
 *
 * 选项:
 *   --server <url>   中继地址,默认 Tailscale 地址(见 DEFAULT_SERVER)
 *   --archive        推完标记为归档(历史镜像推荐:进"已归档"分组,主列表干净)
 *   --active         强制活跃(进主列表)。与 --archive 互斥,默认行为=活跃
 *   --min-bytes <n>  跳过小于 n 字节的会话(默认 1500,过滤空会话)
 *   --force          忽略幂等记录,重新推(会产生重复消息,慎用)
 *   --dry-run        只统计不发送
 *
 * 幂等:已推送的会话记录在 ~/.happy/.script-pushed.json,批量时自动跳过,
 *       避免重复消息。删除该文件可重置。
 *
 * 加密实现(dataKey 变体)与 happy-cli/src/api/* 完全一致。
 */

import nacl from 'tweetnacl';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, hostname, platform } from 'node:os';
import { join } from 'node:path';

const DEFAULT_SERVER = 'https://jackymac-mini.tailfa00b4.ts.net';
const HAPPY_HOME = join(homedir(), '.happy');
const CLAUDE_PROJECTS = join(homedir(), '.claude', 'projects');
const PUSHED_LOG = join(HAPPY_HOME, '.script-pushed.json');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const opt = { server: DEFAULT_SERVER, archive: false, active: false, force: false, dryRun: false, minBytes: 1500, minConvo: 1, all: false, project: null };
let target = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--server') opt.server = argv[++i];
  else if (a === '--archive') opt.archive = true;
  else if (a === '--active') opt.active = true;
  else if (a === '--force') opt.force = true;
  else if (a === '--dry-run') opt.dryRun = true;
  else if (a === '--min-bytes') opt.minBytes = parseInt(argv[++i], 10);
  else if (a === '--min-convo') opt.minConvo = parseInt(argv[++i], 10);
  else if (a === '--all') opt.all = true;
  else if (a === '--project') opt.project = argv[++i];
  else if (!target) target = a;
}
const ARCHIVE = opt.archive && !opt.active;

// ---------- 凭证 ----------
const cred = JSON.parse(readFileSync(join(HAPPY_HOME, 'access.key'), 'utf8'));
const settings = JSON.parse(readFileSync(join(HAPPY_HOME, 'settings.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const TOKEN = cred.token;
if (!cred.encryption?.publicKey) { console.error('✗ access.key 非 dataKey 形态'); process.exit(1); }
const PUBLIC_KEY = b64dec(cred.encryption.publicKey);
const CLI_VERSION = pkg.version;
const AUTH = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'X-Happy-Client': `cli-coding-session/${CLI_VERSION}` };

// ---------- 加密原语(照抄 src/api/encryption.ts) ----------
function b64(u8) { return Buffer.from(u8).toString('base64'); }
function b64dec(s) { return new Uint8Array(Buffer.from(s, 'base64')); }
function libsodiumEncryptForPublicKey(data, pub) {
  const eph = nacl.box.keyPair();
  const nonce = new Uint8Array(randomBytes(nacl.box.nonceLength));
  const e = nacl.box(data, nonce, pub, eph.secretKey);
  const out = new Uint8Array(eph.publicKey.length + nonce.length + e.length);
  out.set(eph.publicKey, 0); out.set(nonce, eph.publicKey.length); out.set(e, eph.publicKey.length + nonce.length);
  return out;
}
function encryptWithDataKey(data, key) {
  const nonce = new Uint8Array(randomBytes(12));
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data))), cipher.final()]);
  const tag = cipher.getAuthTag();
  const bundle = new Uint8Array(1 + 12 + ct.length + 16);
  bundle.set([0], 0); bundle.set(nonce, 1); bundle.set(new Uint8Array(ct), 13); bundle.set(new Uint8Array(tag), 13 + ct.length);
  return bundle;
}

// ---------- 幂等记录 ----------
function loadPushed() { try { return JSON.parse(readFileSync(PUSHED_LOG, 'utf8')); } catch { return {}; } }
function savePushed(m) { writeFileSync(PUSHED_LOG, JSON.stringify(m, null, 2)); }

// ---------- 单会话推送 ----------
async function pushOne(jsonlPath) {
  const sid = jsonlPath.split('/').pop().replace('.jsonl', '');
  const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const convo = lines.filter((l) => l?.type === 'user' || l?.type === 'assistant');
  if (convo.length < opt.minConvo) return { skipped: convo.length === 0 ? '无对话内容' : `仅${convo.length}轮<${opt.minConvo}` };

  // 标题
  let title = '历史会话';
  for (const l of lines) {
    if (l?.type === 'user' && l?.message?.content) {
      const c = l.message.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.find((b) => b.type === 'text')?.text : null;
      if (t) { title = t.slice(0, 80).replace(/\n/g, ' '); break; }
    }
  }

  // 每会话独立密钥
  const encKey = new Uint8Array(randomBytes(32));
  const edk = libsodiumEncryptForPublicKey(encKey, PUBLIC_KEY);
  const dataEncryptionKey = new Uint8Array(edk.length + 1);
  dataEncryptionKey.set([0], 0); dataEncryptionKey.set(edk, 1);
  const enc = (o) => b64(encryptWithDataKey(o, encKey));

  const now = Date.now();
  const metadata = {
    path: process.cwd(), host: hostname(), version: CLI_VERSION, os: platform(),
    machineId: settings.machineId, homeDir: homedir(), happyHomeDir: HAPPY_HOME,
    happyLibDir: join(homedir(), 'jacky-github', 'happy', 'packages', 'happy-cli'),
    happyToolsDir: join(homedir(), 'jacky-github', 'happy', 'packages', 'happy-cli', 'tools', 'unpacked'),
    startedFromDaemon: false, hostPid: process.pid, startedBy: 'terminal',
    lifecycleState: 'running', lifecycleStateSince: now, flavor: 'claude',
    sandbox: null, dangerouslySkipPermissions: null, summary: { text: title, updatedAt: now },
  };

  if (opt.dryRun) return { dryRun: true, title, lines: lines.length, convo: convo.length };

  // 注册
  const reg = await fetch(`${opt.server}/v1/sessions`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ tag: `import-${sid}`, metadata: enc(metadata), agentState: enc({ controlledByUser: false }), dataEncryptionKey: b64(dataEncryptionKey) }),
  });
  if (!reg.ok) throw new Error(`注册失败 HTTP ${reg.status}: ${await reg.text()}`);
  const sessionId = (await reg.json()).session.id;

  // 推消息(逐行 output,每批 50)
  const msgs = lines.map((line) => ({ content: enc({ role: 'agent', content: { type: 'output', data: line } }), localId: randomUUID() }));
  for (let i = 0; i < msgs.length; i += 50) {
    const r = await fetch(`${opt.server}/v3/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ messages: msgs.slice(i, i + 50) }),
    });
    if (!r.ok) throw new Error(`推消息失败 HTTP ${r.status}: ${await r.text()}`);
  }

  // 归档
  if (ARCHIVE) {
    await fetch(`${opt.server}/v1/sessions/${encodeURIComponent(sessionId)}/archive`, { method: 'POST', headers: AUTH, body: '{}' });
  }
  return { sessionId, title, lines: lines.length, convo: convo.length };
}

// ---------- 收集待推文件 ----------
function collectFiles() {
  if (target) {
    if (target.endsWith('.jsonl') && existsSync(target)) return [target];
    const hashDir = join(CLAUDE_PROJECTS, process.cwd().replaceAll('/', '-'));
    const c = join(hashDir, `${target}.jsonl`);
    if (existsSync(c)) return [c];
    console.error(`✗ 找不到会话: ${target}`); process.exit(1);
  }
  const dirs = opt.project ? [join(CLAUDE_PROJECTS, opt.project)] : readdirSync(CLAUDE_PROJECTS).map((d) => join(CLAUDE_PROJECTS, d));
  const files = [];
  for (const d of dirs) {
    try {
      for (const f of readdirSync(d)) {
        if (!f.endsWith('.jsonl')) continue;
        const p = join(d, f);
        if (statSync(p).size >= opt.minBytes) files.push(p);
      }
    } catch {}
  }
  return files;
}

// ---------- 主流程 ----------
async function main() {
  const files = collectFiles();
  const pushed = loadPushed();
  const todo = opt.force ? files : files.filter((f) => !pushed[f]);

  console.log(`待推: ${todo.length} 个会话(共发现 ${files.length},已跳过 ${files.length - todo.length} 个已推)`);
  console.log(`中继: ${opt.server}`);
  console.log(`模式: ${ARCHIVE ? '归档(进已归档分组)' : '活跃(进主列表)'}${opt.dryRun ? '  [DRY-RUN]' : ''}\n`);

  let ok = 0, skip = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const f = todo[i];
    const name = f.split('/').pop().slice(0, 8);
    try {
      const r = await pushOne(f);
      if (r.skipped) { skip++; process.stdout.write(`\r[${i + 1}/${todo.length}] 跳过(${r.skipped}) ${name}            \n`); continue; }
      if (r.dryRun) { console.log(`[${i + 1}/${todo.length}] ${r.convo} 轮对话 / ${r.lines} 行  「${r.title}」`); ok++; continue; }
      pushed[f] = { sessionId: r.sessionId, title: r.title, at: now2() };
      savePushed(pushed);
      ok++;
      process.stdout.write(`\r[${i + 1}/${todo.length}] ✓ ${r.convo}轮 「${r.title.slice(0, 30)}」            \n`);
    } catch (e) {
      fail++;
      console.log(`\r[${i + 1}/${todo.length}] ✗ ${name}: ${e.message}            `);
    }
  }
  console.log(`\n完成: 成功 ${ok} / 跳过 ${skip} / 失败 ${fail}`);
  if (!opt.dryRun && ok > 0) console.log(`提示: 已推会话记录在 ${PUSHED_LOG};${ARCHIVE ? '在 App「已归档」分组查看' : '在主列表查看'}`);
}
function now2() { return new Date(parseInt(process.env.NOW || '0', 10) || Date.parse('2026-06-18')).toISOString(); }

main().catch((e) => { console.error('✗', e?.message || e); process.exit(1); });
