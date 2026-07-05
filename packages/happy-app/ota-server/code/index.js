// happy-ota-server —— 自建 Expo OTA「大脑」
// FC v3 custom runtime Web 函数：监听 9000，实现 Expo Updates 协议。
// 收到 App 的检查请求 → 从 OSS 读 manifest → 按 multipart/mixed 协议回应。

const http = require('http');
const crypto = require('crypto');

// ============ 配置区 ============
const OSS_PUBLIC_BASE = 'https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com';
const BOUNDARY = 'expoupdatesboundaryhappyota20260626'; // 任意唯一串
const PORT = process.env.FC_SERVER_PORT || 9000;
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

function stableUuid(input) {
  const bytes = crypto.createHash('sha256').update(input).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function parseExtraParam(extraParamsHeader, key) {
  if (!extraParamsHeader) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*=\\s*"?([A-Za-z0-9_.:-]+)"?`).exec(extraParamsHeader);
  return m ? m[1] : null;
}

function normalizeGeneration(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return value;
  }
  return String(Date.now());
}

function maxIsoDate(a, bMs) {
  const aMs = Date.parse(a || '');
  const safeA = Number.isFinite(aMs) ? aMs : 0;
  return new Date(Math.max(safeA, Number(bMs))).toISOString();
}

function virtualizeManifest(manifest, target) {
  if (!target) return manifest;

  const generation = normalizeGeneration(target.generation);
  const mode = target.stamp === 'latest' ? 'latest' : 'locked';
  const originalId = manifest.id;
  const virtualId = stableUuid([
    'happy-ota-target-v1',
    mode,
    target.stamp,
    generation,
    originalId,
  ].join(':'));

  return {
    ...manifest,
    id: virtualId,
    createdAt: maxIsoDate(manifest.createdAt, generation),
    metadata: {
      ...(manifest.metadata || {}),
      'happy-ota-mode': mode,
      'happy-ota-target-stamp': target.stamp,
      'happy-ota-generation': generation,
      'happy-ota-original-id': originalId,
    },
    extra: {
      ...(manifest.extra || {}),
      otaTarget: {
        mode,
        stamp: target.stamp,
        generation,
        originalUpdateId: originalId,
        virtualUpdateId: virtualId,
      },
    },
  };
}

// 从 expo-extra-params 头里解析出 App 设置的 ota-target-stamp（定向版本锁定）。
//
// expo-updates 客户端把 `Updates.setExtraParamAsync(key, value)` 设的参数，
// 以 RFC 8941 structured-field dictionary 形式塞进 `Expo-Extra-Params` 请求头，
// 形如：`ota-target-stamp="1782729144216", foo="bar"`。
// 允许两种目标：
//   - 纯数字 stamp：锁定某个历史版本
//   - latest：解除锁定后仍发送一个 generation，让 latest 也能抢过本机缓存的虚拟历史版本
function parseOtaTarget(extraParamsHeader) {
  const stamp = parseExtraParam(extraParamsHeader, 'ota-target-stamp');
  if (!stamp || (stamp !== 'latest' && !/^\d+$/.test(stamp))) {
    return null;
  }

  return {
    stamp,
    generation: normalizeGeneration(parseExtraParam(extraParamsHeader, 'ota-target-generation')),
  };
}

const updatesHeaders = {
  'content-type': `multipart/mixed; boundary=${BOUNDARY}`,
  'expo-protocol-version': '1',
  'expo-sfv-version': '0',
  'cache-control': 'private, max-age=0',
};

const server = http.createServer(async (req, res) => {
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
    const otaTarget = channel === 'preview' ? parseOtaTarget(h['expo-extra-params']) : null;
    const channelBase = `${OSS_PUBLIC_BASE}/manifests/${platform}/${runtimeVersion}/${channel}`;

    let r;
    // 锁定了具体版本 → 先取该历史 manifest；取不到（已被清理/拼错）则静默回退到 latest，
    // 符合「never show loading error，always retry」——宁可给最新也不报错。
    if (otaTarget && otaTarget.stamp !== 'latest') {
      r = await fetch(`${channelBase}/${otaTarget.stamp}.json`);
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

    const manifest = virtualizeManifest(await r.json(), otaTarget);

    // 已经是最新 → 回「无需更新」指令；否则回 manifest
    let body;
    if (currentUpdateId && manifest.id === currentUpdateId) {
      body = buildMultipart('directive', { type: 'noUpdateAvailable' });
    } else {
      body = buildMultipart('manifest', manifest);
    }

    res.writeHead(200, updatesHeaders);
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('error: ' + (e && e.message));
  }
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('happy-ota-server listening on', PORT);
  });
}

module.exports = {
  buildMultipart,
  parseOtaTarget,
  server,
  stableUuid,
  virtualizeManifest,
};
