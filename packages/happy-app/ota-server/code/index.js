// happy-ota-server —— 自建 Expo OTA「大脑」
// FC v3 custom runtime Web 函数：监听 9000，实现 Expo Updates 协议。
// 收到 App 的检查请求 → 从 OSS 读 manifest → 按 multipart/mixed 协议回应。

const http = require('http');

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

// 从 expo-extra-params 头里解析出 App 设置的 ota-target-stamp（定向版本锁定）。
//
// expo-updates 客户端把 `Updates.setExtraParamAsync(key, value)` 设的参数，
// 以 RFC 8941 structured-field dictionary 形式塞进 `Expo-Extra-Params` 请求头，
// 形如：`ota-target-stamp="1782729144216", foo="bar"`。
// 这里只关心 ota-target-stamp，且严格白名单：必须是纯数字串（毫秒时间戳），
// 既防路径穿越（拼进 OSS key），也排除任何非法取值。解析失败一律返回 null（= 不锁定）。
function parseTargetStamp(extraParamsHeader) {
  if (!extraParamsHeader) return null;
  // 兼容带引号 ota-target-stamp="123" 与裸 token ota-target-stamp=123 两种写法
  const m = /ota-target-stamp\s*=\s*"?(\d+)"?/.exec(extraParamsHeader);
  if (!m) return null;
  const stamp = m[1];
  return /^\d+$/.test(stamp) ? stamp : null;
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
    const targetStamp = channel === 'preview' ? parseTargetStamp(h['expo-extra-params']) : null;
    const channelBase = `${OSS_PUBLIC_BASE}/manifests/${platform}/${runtimeVersion}/${channel}`;

    let r;
    // 锁定了具体版本 → 先取该历史 manifest；取不到（已被清理/拼错）则静默回退到 latest，
    // 符合「never show loading error，always retry」——宁可给最新也不报错。
    if (targetStamp) {
      r = await fetch(`${channelBase}/${targetStamp}.json`);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log('happy-ota-server listening on', PORT);
});
