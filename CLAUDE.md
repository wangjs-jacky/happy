# CLAUDE.md — 二开协作约定

> 本仓库是 [slopus/happy](https://github.com/slopus/happy) 的个人二开 fork。
> 本文件规定**分支模型**与 **worktree 开发流程**，所有在本仓库工作的 Claude 会话都必须遵守。

## 一、远端与仓库

| 远端 | 地址 | 用途 |
|------|------|------|
| `origin` | `github.com/wangjs-jacky/happy` | 你的 fork，**二开主场**，所有开发推这里 |
| `upstream` | `github.com/slopus/happy` | 上游原项目，**只读**，仅用于跟进更新 |

## 二、分支模型

```
upstream/main (slopus)         ← 上游基线，只读，永不直接改
        │  fetch / merge
        ▼
   origin/jacky-main           ← 【你的主分支】二开长期集成基线
        ▲
        │  Pull Request（不直接 push 功能 commit）
   feat/* · fix/*              ← 功能/修复分支，从 jacky-main 切出
```

- **`jacky-main` 是本 fork 的主分支**，是二开的集成基线，所有成果最终汇入这里。
- **禁止把功能 commit 直接 push 到 `jacky-main`**，一律通过 PR 合入（`--base jacky-main`），保留评审与记录。
- 功能分支从 `jacky-main` 切出，开发完提 PR 回 `jacky-main`。

> ⚠️ 根目录 `AGENTS.md` 里的 "Sync To Main" 工作流针对的是上游语境的 `origin/main`。
> 在本 fork 二开语境中，「主分支」始终指 **`jacky-main`**，以本文件为准。

## 三、日常开发流程

```bash
# 1. 确保 jacky-main 最新
git switch jacky-main && git pull origin jacky-main

# 2. 切功能分支（推荐用 worktree，见第四节）
git switch -c feat/<topic> jacky-main

# 3. 开发、提交（提交信息见第六节）
git add -p && git commit

# 4. 推送到 fork
git push -u origin feat/<topic>

# 5. 提 PR 到 jacky-main
gh pr create --repo wangjs-jacky/happy --base jacky-main --head feat/<topic>
```

## 四、Worktree 开发流程（隔离开发，推荐）

需要在不打断当前工作区的前提下并行开发时，用 git worktree。约定如下（与全局 `~/.claude/CLAUDE.md` 一致）：

| 项目 | 约定 |
|------|------|
| **位置** | 仓库**同级目录（sibling）**：`../happy--<topic>`。**不要**放在仓库内部或 `.claude/worktrees/` 等工具默认路径 |
| **命名** | 目录 `happy--<topic>`；分支名直接用 `<topic>` slug，**不加 `worktree-` 前缀** |
| **基分支** | 一律从 `jacky-main` 切 |

### 创建

```bash
# 从 jacky-main 切出隔离 worktree + 同名分支
git worktree add ../happy--<topic> -b <topic> jacky-main
```

### 安装依赖（pnpm monorepo）

本仓库是 **pnpm workspace**（`pnpm@10.11.0`，7 个包）。worktree 里直接重新安装即可，pnpm 全局 store 会硬链接复用、很快：

```bash
cd ../happy--<topic>
pnpm install
```

> ❗ **不要**像普通 npm 项目那样 symlink 整个 `node_modules`：pnpm 的 `node_modules/.pnpm` 虚拟 store + 各 workspace 包各自的 `node_modules` 结构复杂，symlink 极易损坏。老老实实 `pnpm install`。

### 开发完成

```bash
# 推送并提 PR
git -C ../happy--<topic> push -u origin <topic>
gh pr create --repo wangjs-jacky/happy --base jacky-main --head <topic>

# 合并后清理 worktree 与分支
git worktree remove ../happy--<topic>
git branch -d <topic>
```

## 五、同步上游更新

定期把上游的新提交并入 `jacky-main`：

```bash
git fetch upstream
git switch jacky-main
git merge upstream/main        # 或 git rebase upstream/main
# 解决冲突后
git push origin jacky-main
```

## 六、构建与本机运行说明

- **构建单个包**：`cd packages/happy-cli && pnpm run build`（`tsc --noEmit && pkgroll`，产物在 `dist/`，已被 `.gitignore` 忽略）。
- **本机为 dev-link 模式**：全局 `happy` 命令通过 `npm link` 指向 `packages/happy-cli`。因此**改源码 → `pnpm run build` 重建 `dist/` 即对新会话生效，无需发布 npm 包**。
  - daemon 给每个新会话 spawn 全新进程读取 `dist/`，**重建后不必重启 daemon**；但**已在运行的会话**仍是旧代码（已加载进内存），需新开会话才用上新代码。
- 只有当你想让**其他机器 / 其他人**用上改动，或想从 dev-link 切回干净的 npm 安装版时，才需要走「发 npm 包」流程。

## 七、提交信息规范

```
<type>(<scope>): <简述>

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
```

- 推送/拉取前若需代理：`git config --global http.proxy http://127.0.0.1:10802`（https 同理），完成后 `--unset`。

## 八、本地构建 Android APK 并发布到 GitHub Release

> 在本机直接出一个可 sideload 安装的 Android APK，并作为构建产物发到 GitHub Release（不进 npm、不进商店）。所有命令在 `packages/happy-app/` 下执行。

### 前置条件（本机已就绪，换机时核对）

- JDK 17（`java -version`）、`ANDROID_HOME` 已指向 Android SDK、`android/gradlew` 存在
- **无需自备 keystore**：`android/app/build.gradle` 中 release 签名回退到 `debug.keystore`，产物为 debug 签名，足够 sideload 安装/内测（**不可上架商店**）

### 构建步骤

```bash
cd packages/happy-app

# 1) android/ 是 gitignore 的 prebuild 产物。首次/换机/配置变更后需重建；已存在可跳过
pnpm prebuild                  # = rm -rf android ios && expo prebuild

# 2) 构建 release APK（APP_ENV 决定环境，按需 preview/production）
#    必须加 -PreactNativeArchitectures=arm64-v8a 只打真机用的 arm64：
cd android && APP_ENV=production ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a

# 产物固定路径：
#   packages/happy-app/android/app/build/outputs/apk/release/app-release.apk
```

> ⚠️ **务必带 `-PreactNativeArchitectures=arm64-v8a`**：`gradle.properties` 默认 `reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64`，不加参数直接 `assembleRelease` 会打成含 4 种架构的 **universal 包（~293MB）**，其中 x86/x86_64 是模拟器专用、armeabi-v7a 是老 32 位 ARM，真机全用不到。只打 arm64 后包体回到 **~122MB**。sideload 给真机一律只要 arm64。

> 想直接装到连着的真机/模拟器而不出 APK 文件，用 `pnpm android:production`（会 install 而非只 assemble）。

### 发布到 GitHub Release

```bash
# 版本号取自 app.config.js（APP_ENV=production 下当前为 1.7.0），不要用 package.json 的 1.0.0
VERSION=$(cd packages/happy-app && APP_ENV=production node -e "const c=require('./app.config.js');const cfg=typeof c==='function'?c({config:{}}):(c.default||c);console.log(cfg.expo?.version||cfg.version)")
TAG="android-v$VERSION"            # tag 加 android- 前缀，与桌面/其他端 release 区分
APK="packages/happy-app/android/app/build/outputs/apk/release/app-release.apk"

# 走代理（见第七节）后再推 tag 与建 release
git tag "$TAG" && git push origin "$TAG"
gh release create "$TAG" --repo wangjs-jacky/happy \
  --title "Android $TAG" \
  --notes "本地构建的 Android APK（debug 签名，可直接 sideload）。" \
  "$APK"
```

### 约定

- **Release tag 用 `android-v<version>` 前缀**，避免与 iOS/桌面端或上游 release 命名冲突
- APK 是构建产物，**不提交进 git**（`*.apk` 已隐含在 prebuild 产物链路中，不要 `git add`）
- 同一版本号重复发布前先删旧 release/tag，或递增 `app.config.js` 的 version
- 此流程纯属本机/内测分发；正式商店包仍走 EAS（`pnpm release:build:appstore`）

## 九、自建 OTA：发布、版本管理与真机验证

> 改了 JS 层（RN 组件 / 逻辑，**无原生改动**）后，不必重新出 APK，直接推自建 OTA，真机冷启动即拉到更新。所有命令在 `packages/happy-app/` 下执行。

### 机制速记

- 自建 OTA 把 `expo export` 的产物上传到**阿里云 OSS 桶 `happy-app-ota-jacky`**（`oss-cn-hangzhou`），脚本 `scripts/publish-ota.js`。
- 当前只发 **Android、`runtimeVersion: 21`**（见 `app.config.js`）。**runtimeVersion 必须和装机 APK 完全一致**，否则该机器永远跳过这次更新。
- **频道（channel）分流**：App 端 `updates.url` 指向 FC 服务 `happy-oa-server-...fcapp.run`，请求头 `expo-channel-name` **按构建变体注入**（`app.config.js` 的 `otaChannel` 映射）：
  - **dev / preview 包 → `preview` 频道**（给开发在真机预览 PR）
  - **production 包 → `production` 频道**（线上正式用户）
  - FC 服务按该频道头取 `manifests/<platform>/<runtime>/<channel>/latest.json`；production 频道在新路径未命中时回退到旧的无 channel 路径（存量用户无感）。改 url / 频道映射都必须重新构建装机才生效。
- 凭证复用本机 `aliyun configure` 的默认 profile（`~/.aliyun/config.json`），脚本用 `aliyun ossutil` 上传，无需环境变量里写 AccessKey。

### 发布

```bash
cd packages/happy-app
pnpm ota:selfhost            # 发到 production 频道（= node scripts/publish-ota.js，缺省 production）
pnpm ota:selfhost:preview    # 发到 preview 频道（= ... --channel preview，仅 preview 包能拉到）
# 也可手动指定：node scripts/publish-ota.js --channel <channel> --platform <android|ios>
```

- **PR 预览自动化**：协作者把分支推到本仓库并对 `jacky-main` 提 PR 后，`.github/workflows/ota-preview.yml`
  会自动 `expo export` + 发到 `preview` 频道，并在 PR 上评论 Update ID 与验证步骤。开发用 preview 包真机预览，
  确认无误再合并。需在仓库 Secrets 配 `ALIYUN_OSS_ACCESS_KEY_ID` / `ALIYUN_OSS_ACCESS_KEY_SECRET`（建议用只授权该桶的 RAM 子账号）。fork 来的 PR 因拿不到 secret 会自动跳过。
- 建议**先在功能分支提交一次再发**，让发出去的包对得上一个明确 commit。
- 发布成功会打印「频道 / 新版本 id（UUID）/ manifest 地址」。OSS 上版本结构（按频道分层）：
  - `manifests/android/21/<channel>/latest.json` —— 该频道当前线上指针（每次覆盖）
  - `manifests/android/21/<channel>/<毫秒时间戳>.json` —— 每次发布留的历史备份（JS 包从不删，故任意历史版本可回滚）

### 列出全部 OTA 版本 / 看当前线上

```bash
# 注意带上频道段（production / preview）
aliyun ossutil ls oss://happy-app-ota-jacky/manifests/android/21/production/ | grep -E '\.json'
```

- `latest.json` 与某个 `<时间戳>.json` 的 **ETag 相同** → 那个时间戳就是当前线上版本。
- 或直接 `pnpm ota:rollback`（生产频道）/ `pnpm ota:rollback:preview`（预览频道）：列出该频道所有历史版本并标注「← 当前线上」，选序号即把该版本覆盖回 `latest.json` 完成回滚。

### 真机验证「是否已拉到本次 OTA」

App 内 `useUpdates`（`sources/hooks/useUpdates.ts`）在**每次启动 + 每次切回前台**查更新，查到就后台下载并弹「**有可用更新**」横幅；点横幅 `reloadApp()` 重载进新包，不点则下次冷启动自动生效（`__DEV__` 下不查更新）。

两种验证手段：

1. **看行为**（最快）：完全杀掉 App 重开 → 等横幅 → 点它重载（或再冷启一次）→ 观察这次 OTA 的可见改动是否出现。
2. **看 Update ID**（最准）：
   - **设置 → 连点底部「版本号」那一行好几下** 解锁开发者模式（多击 hook 在 `SettingsView.tsx`，切 `devModeEnabled`）。
   - 出现 **Developer** 分组 → `/dev` → **Expo Constants**（`/dev/expo-constants`）。
   - **Update ID** 应等于发布时打印的那个 UUID；同页 **Runtime Version** 必须是 `21`。对上即真机正跑该 OTA。

> 服务端侧无法直接确认设备是否来拉（OSS 未开访问日志）；以真机上的 **Update ID / 行为** 为准。PostHog 有 `ota_update_available` / `ota_update_applied` 事件（带 `ota_version`）可作旁证。

<!-- ob-index:start -->
## Obsidian 知识库

> 索引路径：`/Users/jacky/jacky-github/jacky-obsidian/wiki/projects/happy/index.md`
> 渐进式加载：先读本概览，需要详情时读取索引文件，再读取具体文章。

| 文件 | 主题 | 何时读取 |
|------|------|----------|
| foreground-push-notification.md | 让会话通知在 App 前台也弹 + 点通知跳转会话 | 改推送通知行为、排查「收不到通知」时 |
| selfhost-server-deploy.md | 把服务端源码改动部署到阿里云 VPS（docker 离线叠层 + esbuild） | 部署/重建 happy-server、改服务端代码要上线时 |
<!-- ob-index:end -->
