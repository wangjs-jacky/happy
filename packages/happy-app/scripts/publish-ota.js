// scripts/publish-ota.js
// 作用：把 `expo export` 的产物上传到阿里云 OSS，并生成 Expo Updates 协议要求的 manifest 清单。
// 用法：node scripts/publish-ota.js   （或 npm run ota:android）
//
// 凭证来源：本脚本通过 `aliyun ossutil` 上传，复用 aliyun CLI 已配置的默认 profile 凭证
//（~/.aliyun/config.json），因此无需在环境变量里再写 AccessKey。
// 前提：本机已 `aliyun configure` 配好可读写该桶的凭证。

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ============ 配置区：按你自己的情况修改 ============
const BUCKET = 'happy-app-ota-jacky';          // OSS 桶名
const REGION = 'oss-cn-hangzhou';              // OSS 地域
const RUNTIME_VERSION = '21';                  // 必须和 app.config.js 的 runtimeVersion 一致
const PLATFORM = 'android';                    // 平台
const DIST_DIR = path.join(__dirname, '..', 'dist'); // expo export 输出目录
const ALIYUN_BIN = process.env.ALIYUN_BIN || 'aliyun'; // aliyun CLI 可执行名/路径
// OSS 公开访问域名（https）
const OSS_PUBLIC_BASE = `https://${BUCKET}.${REGION}.aliyuncs.com`;
// ===================================================

// ---- 工具函数 ----

// sha256 → URL 安全 base64（manifest 的 hash 字段要求这个格式）
function sha256Base64URL(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// md5 十六进制，作为缓存键 key
function md5Hex(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

// 扩展名 → contentType
function mimeOf(ext) {
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
    json: 'application/json', mp4: 'video/mp4', mp3: 'audio/mpeg',
  };
  return map[(ext || '').toLowerCase()] || 'application/octet-stream';
}

// hash 十六进制 → UUID（manifest 的 id 字段要求 UUID 格式）
function toUUID(hashHex) {
  const h = hashHex.slice(0, 32);
  return (
    h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
    h.slice(16, 20) + '-' + h.slice(20, 32)
  );
}

// 用 aliyun ossutil 上传一个本地文件到 OSS 指定 key
function ossUpload(localPath, ossKey, contentType) {
  execFileSync(
    ALIYUN_BIN,
    ['ossutil', 'cp', localPath, `oss://${BUCKET}/${ossKey}`,
      '--force', '--content-type', contentType],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  console.log('  已上传:', ossKey);
}

// 整目录递归上传到 OSS 指定前缀（assets 有几百个文件，逐个起进程太慢，一次性传）
function ossUploadDir(localDir, ossPrefix) {
  execFileSync(
    ALIYUN_BIN,
    ['ossutil', 'cp', localDir.replace(/\/?$/, '/'), `oss://${BUCKET}/${ossPrefix}`,
      '-r', '--force'],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
}

// ---- 主流程 ----
async function main() {
  // 0) 自检 aliyun 是否可用
  try {
    execFileSync(ALIYUN_BIN, ['ossutil', 'version'], { stdio: 'ignore' });
  } catch (e) {
    console.error('错误：找不到可用的 aliyun CLI（ossutil）。请先安装并 `aliyun configure`。');
    process.exit(1);
  }

  // 1) 读取 metadata.json
  const metaPath = path.join(DIST_DIR, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    console.error(`错误：找不到 ${metaPath}。请先运行 npx expo export --platform ${PLATFORM}`);
    process.exit(1);
  }
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const fileMeta = metadata.fileMetadata[PLATFORM];
  if (!fileMeta) {
    console.error(`错误：metadata.json 里没有 ${PLATFORM} 平台数据，确认 export 时带了 --platform ${PLATFORM}`);
    process.exit(1);
  }

  // 2) 本次发布目录（时间戳，保证唯一、可回滚）
  const stamp = String(Date.now());
  const baseKey = `updates/${PLATFORM}/${RUNTIME_VERSION}/${stamp}`;
  console.log('本次发布目录:', baseKey);

  // 3) JS 主包（launchAsset）
  const bundleRelPath = fileMeta.bundle;
  const bundleBuf = fs.readFileSync(path.join(DIST_DIR, bundleRelPath));
  const bundleKey = `${baseKey}/bundle.js`;
  ossUpload(path.join(DIST_DIR, bundleRelPath), bundleKey, 'application/javascript');
  const launchAsset = {
    hash: sha256Base64URL(bundleBuf),
    key: md5Hex(bundleBuf),
    contentType: 'application/javascript',
    url: `${OSS_PUBLIC_BASE}/${bundleKey}`,
  };

  // 4) 资源 assets：整目录递归上传一次（dist/assets/ 下全是扁平 hash 文件名）
  const assetList = fileMeta.assets || [];
  if (assetList.length > 0) {
    console.log(`上传 assets 目录（${assetList.length} 个引用 / 去重后若干）...`);
    ossUploadDir(path.join(DIST_DIR, 'assets'), `${baseKey}/assets/`);
  }
  // 再在本地为每个 asset 算 hash/key、拼 manifest 条目（url 用 a.path，即 assets/<hash>）
  const assets = assetList.map((a) => {
    const assetBuf = fs.readFileSync(path.join(DIST_DIR, a.path));
    return {
      hash: sha256Base64URL(assetBuf),
      key: md5Hex(assetBuf),
      contentType: mimeOf(a.ext),
      fileExtension: '.' + a.ext,
      url: `${OSS_PUBLIC_BASE}/${baseKey}/${a.path}`,
    };
  });

  // 5) 组装 manifest
  const manifest = {
    id: toUUID(crypto.createHash('sha256').update(bundleBuf.toString('hex') + stamp).digest('hex')),
    createdAt: new Date(Number(stamp)).toISOString(),
    runtimeVersion: RUNTIME_VERSION,
    launchAsset,
    assets,
    metadata: {},
    extra: {},
  };

  // 6) 上传 manifest 到固定位置 latest.json（每次覆盖）。先写临时文件再传。
  const tmpManifest = path.join(os.tmpdir(), `ota-manifest-${stamp}.json`);
  fs.writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2));
  const manifestKey = `manifests/${PLATFORM}/${RUNTIME_VERSION}/latest.json`;
  ossUpload(tmpManifest, manifestKey, 'application/json');
  // 同时按时间戳留一份备份，方便回滚
  ossUpload(tmpManifest, `manifests/${PLATFORM}/${RUNTIME_VERSION}/${stamp}.json`, 'application/json');
  fs.unlinkSync(tmpManifest);

  console.log('\n✅ 发布完成！');
  console.log('manifest 地址:', `${OSS_PUBLIC_BASE}/${manifestKey}`);
  console.log('新版本 id:', manifest.id);
}

main().catch((err) => {
  console.error('发布失败:', err && (err.stderr ? err.stderr.toString() : err.message) || err);
  process.exit(1);
});
