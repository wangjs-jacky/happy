// happy-ota-server —— 自建 Expo OTA「大脑」
// FC v3 custom runtime Web 函数：监听 9000，实现 Expo Updates 协议。
// 收到 App 的检查请求 → 从 OSS 读 manifest → 按 multipart/mixed 协议回应。

const http = require('http');
const crypto = require('crypto');

// ============ 配置区 ============
const OSS_PUBLIC_BASE = 'https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com';
const BOUNDARY = 'expoupdatesboundaryhappyota20260626'; // 任意唯一串
const PORT = process.env.FC_SERVER_PORT || 9000;
const UUID_NAMESPACE = '62f03f7a-8691-4f44-b2ee-8efb8642d5e1';
// ===============================

// 组装 multipart/mixed 回应体（行尾必须 \r\n）
function buildMultipart(partName, jsonObj) {
  const body = JSON.stringify(jsonObj);
  return (
    `--${BOUNDARY}\r\n` +
    `content-type: application/json\r\n` +
    `content-disposition: form-data; name="${partName}"\r\n` +
    `\r\n` +
    `${body}\r\n` +
    `--${BOUNDARY}--\r\n`
  );
}

// 从 expo-extra-params 头里解析出 App 设置的 OTA 定向参数。
//
// expo-updates 客户端把 `Updates.setExtraParamAsync(key, value)` 设的参数，
// 以 RFC 8941 structured-field dictionary 形式塞进 `Expo-Extra-Params` 请求头，
// 形如：`ota-target-stamp="1782729144216", ota-target-generation="1783449000000"`。
// ota-target-stamp 支持纯数字历史 stamp，或 latest（解除历史锁定但仍强制拉 latest）。
// 其他值一律忽略，防止路径穿越。
function parseExtraParam(extraParamsHeader, key) {
  if (!extraParamsHeader) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*=\\s*"?([^",;\\s]+)"?`, 'i').exec(extraParamsHeader);
  if (!m) return null;
  return m[1] || null;
}

function parseTargetDirective(extraParamsHeader, now = Date.now) {
  const rawTarget = parseExtraParam(extraParamsHeader, 'ota-target-stamp');
  if (!rawTarget) return null;

  const rawGeneration = parseExtraParam(extraParamsHeader, 'ota-target-generation');
  const generation = rawGeneration && /^\d+$/.test(rawGeneration) ? rawGeneration : null;
  if (/^\d+$/.test(rawTarget)) {
    return {
      mode: 'locked',
      stamp: rawTarget,
      // Old App builds did not send generation. Use the target stamp as a stable fallback
      // so repeated checks for the same locked version do not create endless virtual ids.
      generation: generation || rawTarget,
    };
  }

  if (rawTarget.toLowerCase() === 'latest') {
    return {
      mode: 'latest',
      stamp: null,
      generation: generation || String(now()),
    };
  }

  return null;
}

function uuidToBytes(uuid) {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function createUuidV5(name) {
  const hash = crypto.createHash('sha1')
    .update(uuidToBytes(UUID_NAMESPACE))
    .update(name)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function getVirtualCreatedAt(manifest, directive) {
  const manifestTime = Date.parse(manifest.createdAt || '');
  const generationTime = Number(directive.generation);
  const bestTime = Number.isFinite(generationTime) && generationTime > manifestTime
    ? generationTime
    : manifestTime;
  return Number.isFinite(bestTime) ? new Date(bestTime).toISOString() : new Date().toISOString();
}

function createVirtualManifest(manifest, directive) {
  const originalUpdateId = manifest.id;
  const targetLabel = directive.mode === 'latest' ? 'latest' : directive.stamp;
  const virtualUpdateId = createUuidV5([
    'happy-ota-target',
    directive.mode,
    targetLabel || '',
    directive.generation,
    originalUpdateId,
  ].join(':'));

  return {
    ...manifest,
    id: virtualUpdateId,
    createdAt: getVirtualCreatedAt(manifest, directive),
    metadata: {
      ...(manifest.metadata || {}),
      'happy-ota-mode': directive.mode,
      'happy-ota-target-stamp': targetLabel || '',
      'happy-ota-generation': directive.generation,
      'happy-ota-original-id': originalUpdateId,
    },
    extra: {
      ...(manifest.extra || {}),
      otaTarget: {
        mode: directive.mode,
        stamp: targetLabel,
        generation: directive.generation,
        originalUpdateId,
        virtualUpdateId,
      },
    },
  };
}

const updatesHeaders = {
  'content-type': `multipart/mixed; boundary=${BOUNDARY}`,
  'expo-protocol-version': '1',
  'expo-sfv-version': '0',
  'cache-control': 'private, max-age=0',
};

async function handleRequest(req, res) {
  try {
    const h = req.headers; // FC/Node 里请求头都是小写
    const runtimeVersion = h['expo-runtime-version'] || '';

    // 没有 expo-runtime-version → 视为健康检查 / 浏览器直访，回 200 便于排查
    if (!runtimeVersion) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('happy-ota-server ok');
      return;
    }

    const platform = h['expo-platform'] || 'android';
    const currentUpdateId = h['expo-current-update-id'] || '';
    // 频道：App 端按构建变体注入（preview 包发 preview，production 包发 production）。
    // 缺省 production，兼容未带该头的老客户端。
    const channel = h['expo-channel-name'] || 'production';

    // 定向版本锁定（仅 preview 频道生效）：
    // App 在「OTA 版本」选择器里锁定某个历史版本时，会 setExtraParamAsync('ota-target-stamp', <stamp>)，
    // 该值随 expo-extra-params 头传到这里。命中后取该 stamp 的历史 manifest 而非 latest。
    // production 频道一律忽略（永远跟随 latest），防止误把线上用户锁到旧包。
    const targetDirective = channel === 'preview' ? parseTargetDirective(h['expo-extra-params']) : null;
    const channelBase = `${OSS_PUBLIC_BASE}/manifests/${platform}/${runtimeVersion}/${channel}`;

    let r;
    let effectiveDirective = targetDirective;
    // 锁定了具体版本 → 先取该历史 manifest；取不到（已被清理/拼错）则静默回退到 latest，
    // 符合「never show loading error，always retry」——宁可给最新也不报错。
    if (targetDirective && targetDirective.mode === 'locked') {
      r = await fetch(`${channelBase}/${targetDirective.stamp}.json`);
      if (!r.ok) {
        effectiveDirective = null;
      }
    }
    if (!r || !r.ok) {
      r = await fetch(`${channelBase}/latest.json`);
    }

    // 兼容旧布局：production 频道在引入频道维度前发到的是
    // manifests/<platform>/<runtime>/latest.json（无 channel 段）。
    // 新路径未命中且是 production 时回退到旧路径，保证存量线上用户无感。
    if (!r.ok && channel === 'production') {
      r = await fetch(`${OSS_PUBLIC_BASE}/manifests/${platform}/${runtimeVersion}/latest.json`);
    }

    // 没找到清单 → 当作「无更新」（避免 App 报错）
    if (!r.ok) {
      res.writeHead(200, updatesHeaders);
      res.end(buildMultipart('directive', { type: 'noUpdateAvailable' }));
      return;
    }

    const manifest = await r.json();
    const responseManifest = effectiveDirective
      ? createVirtualManifest(manifest, effectiveDirective)
      : manifest;

    // 已经是最新 → 回「无需更新」指令；否则回 manifest
    let body;
    if (currentUpdateId && responseManifest.id === currentUpdateId) {
      body = buildMultipart('directive', { type: 'noUpdateAvailable' });
    } else {
      body = buildMultipart('manifest', responseManifest);
    }

    res.writeHead(200, updatesHeaders);
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('error: ' + (e && e.message));
  }
}

function createServer() {
  return http.createServer(handleRequest);
}

if (require.main === module) {
  createServer().listen(PORT, '0.0.0.0', () => {
    console.log('happy-ota-server listening on', PORT);
  });
}

module.exports = {
  buildMultipart,
  createServer,
  createVirtualManifest,
  parseTargetDirective,
};
