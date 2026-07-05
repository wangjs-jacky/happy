# OTA 版本浏览站 + App 定向切换 — 设计文档

> 日期：2026-06-29 · 分支：`ota-version-switcher`
> 目标：回归验收时能**明确知道当前看的是哪个 commit 的 OTA**，并能**自由切换到任意历史版本**（仅 preview 频道）。

## 一、背景与痛点

每次回归验收，不知道真机上当前跑的是哪个 commit 的 OTA；想看某个特定版本只能改 `latest.json`（全局、影响所有设备），无法单机定向切换。

## 二、现状澄清（重要）

代码里残留**两套 OTA 发布脚本，但只有自建 OSS 那套对装机包生效**：

| | EAS Update（官方托管） | 自建 OSS OTA |
|---|---|---|
| 脚本 | `pnpm ota` / `ota:production` | `pnpm ota:selfhost` / `:preview` |
| 推到 | `u.expo.dev` | OSS 桶 `happy-app-ota-jacky` + FC 分发 |
| 装机 app 会拉吗 | ❌ 不会 | ✅ 会 |

原因：`app.config.js:227` 把 `updates.url` 指向自建 FC（`happy-oa-server-...fcapp.run`），expo-updates 客户端只认这一个地址，永不访问 EAS。所以 EAS Update 脚本是**死脚本**。`extra.eas.projectId` 仅供 **EAS Build（打原生包）**，与 OTA 无关。

→ 本方案只围绕**自建 OSS OTA**；并顺带清理 EAS Update 死脚本与过时文档。

### 自建 OSS OTA 机制速记

```
expo export → publish-ota.js 传 OSS：
  updates/android/21/<stamp>/bundle.js + assets/        ← JS 包与资源
  manifests/android/21/<channel>/latest.json            ← 频道当前指针（每次覆盖）
  manifests/android/21/<channel>/<stamp>.json           ← 历史备份（永不删，可回滚）
  meta/android/21/<channel>/<stamp>.json                ← 轻量元信息（stamp/id/git/createdAt）

App expo-updates → 请求 FC（带 expo-channel-name / expo-runtime-version / expo-current-update-id）
FC（ota-server/code/index.js）→ 按 channel 取 latest.json 返回 multipart manifest
```

- 频道：dev/preview 包 → `preview`；production 包 → `production`（`app.config.js` 的 `otaChannel` 映射，构建时写死）。
- runtime 固定 `21`。每个 manifest 带 `extra.git = { sha, branch, subject, dirty }`。

## 三、目标与非目标

**目标**
1. 一个 OSS 同桶静态网站，列出 preview 频道所有 OTA 版本（commit/subject/时间），每行带二维码。
2. App 内「OTA 版本」选择器：列出版本、显示当前锁定项、点选切换、解除锁定回到最新。
3. App 处理 `happy://ota-switch?...` deep link，扫码即切。
4. 切换**仅对本设备生效**，不影响其他设备。

**非目标（YAGNI）**
- 不动 production 频道的定向切换能力（永远跟随 latest）。
- 不做 iOS（当前只发 android/runtime 21）。
- 不做版本删除/管理后台，只做"浏览 + 切换"。

## 四、架构

```
①publish-ota.js（无需改，仅依赖已有 meta/ 目录）
        │
        ▼  OSS（开桶级 list 权限，前端可 ListObjects）
②网站 ota-server/site/index.html（OSS 同桶静态托管）
   - 前端 ListObjects meta/android/21/preview/ → 拿全部 stamp
   - 逐个 fetch meta json → 渲染列表（commit/subject/时间）
   - 每行二维码：happy://ota-switch?channel=preview&stamp=<stamp>
        │ 手机扫码
③App
   - hooks/useOtaVersions.ts：ListObjects + fetch meta，返回版本列表
   - hooks/useOtaTarget.ts：读/写 setExtraParamAsync('ota-target-stamp', …)
   - 设置页「OTA 版本」入口 → 选择器页：列表 + 当前锁定高亮 + 解除锁定
   - deep link 路由 /ota-switch：解析 stamp → 确认 → 切换
        │
        ▼ setExtraParamAsync('ota-target-stamp', stamp) + reloadApp()
FC ota-server/code/index.js（改造）
   - 解析 Expo-Extra-Params header
   - channel === 'preview' 且带 ota-target-stamp → 取 manifests/.../preview/<stamp>.json
   - 否则 → latest.json（原行为不变）
```

## 五、数据流：锁定 / 恢复 / 当前状态

- **锁定到某版本**：`setExtraParamAsync('ota-target-stamp', '<stamp>')`（持久化）→ `reloadApp()`。此后每次启动都拉该版本。
- **解除锁定**：`setExtraParamAsync('ota-target-stamp', null)` → reload → 回到跟随 latest。
- **当前在看哪个**：选择器读当前 extra param + 对应 meta 的 git 信息，高亮并显示 commit/subject；无锁定则标"跟随最新"。**直接解决"不知道在看哪个 commit"。**

## 六、关键技术命脉与验证（实施第一步）

整套依赖 expo-updates 的 `Updates.setExtraParamAsync(key, value)`：所设参数以 `Expo-Extra-Params` 请求头（RFC 8941 structured-field dict，形如 `ota-target-stamp="1782729144216"`）发给 update server。

**风险**：需确认本项目 expo-updates（~55）此行为，且 stamp（纯数字串）符合 extra-params 取值字符集。

**验证方式（动 UI 前先做）**：在 FC 临时打印收到的 `expo-extra-params` header（或加一个 echo 分支），App 端 `setExtraParamAsync` 后触发 checkForUpdate，确认 FC 端收到该 header 且能解析出 stamp。验证通过再继续。

## 七、安全边界

- FC 仅在 `channel === 'preview'` 时读取 `ota-target-stamp`；production 一律忽略、永远 latest。误操作锁不到线上包。
- `stamp` 校验：FC 只接受纯数字串，拼路径前正则白名单，防路径穿越。
- 找不到 `<stamp>.json` → 回退 latest（不报错，符合"never show loading error"）。

## 八、OSS 权限变更

桶当前只开对象公共读，**未开匿名 list**（已验证 ListObjects 返回 AccessDenied）。需给桶加一条 bucket policy：对前缀 `meta/` 与 `manifests/`（仅这两个前缀，不暴露 `updates/` 下 bundle）授予匿名 `oss:ListObjects` / `oss:GetObject`。用 `aliyun ossutil` 设置 bucket-policy（本机已有凭证）。

> 注意：开 list 会暴露这两个前缀下的对象 key 列表（版本时间戳、commit）。preview 频道的版本信息属可接受的内部信息，风险低。

## 九、顺带清理（EAS Update 死脚本）

- `package.json`：移除 `ota`、`ota:production` 两个死脚本（保留 `ota:selfhost*` / `ota:rollback*`）。
- `packages/happy-app/CLAUDE.md`："### Production - `pnpm ota` - Deploy OTA via EAS Update" 改为指向自建 OSS 说明。
- 保留 `extra.eas.projectId`（EAS Build 仍需）。

## 十、各部分改动清单

| 部分 | 文件 | 改动 |
|---|---|---|
| FC | `ota-server/code/index.js` | 解析 extra-params，preview+stamp 时取指定 manifest；含 stamp 白名单与回退 |
| App hook | `sources/hooks/useOtaVersions.ts`（新） | ListObjects + fetch meta，返回版本列表（含 git） |
| App hook | `sources/hooks/useOtaTarget.ts`（新） | 读写 `ota-target-stamp` extra param |
| App 页面 | `sources/app/(app)/dev/ota-versions.tsx` 或设置子页（新） | 选择器 UI（ItemList，当前项高亮，解除锁定） |
| App 入口 | `sources/components/SettingsView.tsx` | 加「OTA 版本」入口（Developer 分组下） |
| App deep link | 路由 `/ota-switch`（新） | 解析 query → 确认 modal → 切换 |
| 网站 | `ota-server/site/index.html`（新，单文件） | Terminal Noir 风格，列表 + 二维码 |
| 清理 | `package.json` / `happy-app/CLAUDE.md` | 移除 EAS 死脚本 + 修文档 |

## 十一、验收标准

1. 网站部署后公开可访问，列出 preview 全部版本，扫码能唤起 App。
2. App 选择器列出版本、正确高亮当前锁定项。
3. 选一个旧版本 → reload → `/dev/expo-constants` 的 Update ID 等于该版本 id。
4. 解除锁定 → reload → 回到 latest。
5. production 包不受影响（无法定向切）。
6. `pnpm typecheck` 通过。
