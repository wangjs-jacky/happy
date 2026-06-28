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

    // 从 OSS 取对应清单（按频道分流）：manifests/<platform>/<runtime>/<channel>/latest.json
    const manifestUrl =
      `${OSS_PUBLIC_BASE}/manifests/${platform}/${runtimeVersion}/${channel}/latest.json`;
    let r = await fetch(manifestUrl);

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
