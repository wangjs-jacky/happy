# 设计:能力中心「文件夹浏览」模块

> 在 Happy App 会话右侧「能力中心」加一个文件夹浏览器:进入某个会话后,可以逐层浏览该会话工作目录(乃至整个 HOME)下的文件结构,点开任意文件用现成的查看器看内容(语法高亮 / diff / 二进制识别)。

## 一、背景与目标

### 要解决的问题

用户在手机端用 Happy 远程操控机器上的 Claude Code / Codex 会话时,除了聊天,常常想「看一眼整个项目的文件结构」或「翻某个 `.ts` / `.md` 文件」。目前能力中心右侧面板里有一格 **Artifacts**,对该用户永远是空的(Artifacts 是服务端同步的另一套功能,需要桌面/网页端生成才有内容)。用户希望把这一格改成「快速浏览当前文件夹底下内容」的入口。

### 目标(v1)

1. 进入某个**活跃会话**后,能力中心里出现一张「文件夹」卡(占用原 Artifacts 那格)。
2. 点开后进入一个 **Finder 式逐层目录浏览器**,根目录 = 会话工作目录 `session.metadata.path`。
3. 可以**往下钻**进子目录,也可以**往上爬**——上限到该机器的 **HOME 目录**为止(能看 home 下其它项目 / 配置,进不去 `/etc`、`/`、其它用户目录)。
4. 点某个文件 → 打开**现有的**文件查看器 `/session/[id]/file`,零新增地复用语法高亮 / diff / 二进制识别 / 缓存。

### 非目标(明确排除)

- **不做 ComposeHome(新建会话首页,无会话)场景**:那里没有会话级 RPC,只有 `machineBrowseDirectory`(仅列目录、不能读文件)。本次只做会话内。
- **不动写操作**:`writeFile` 保持锁在工作目录内。本功能是**只读**浏览器。
- **不做搜索 / 过滤 / 新建 / 重命名**等文件管理动作。
- **不保留 Artifacts 卡的入口**(用户明确选择占用该格)。Artifacts 的底层 model/detail 代码**保留不删**,`/artifacts` 路由仍在,只是能力中心不再显示这张卡——随时可回退。

## 二、现状调研(可复用的基建)

| 能力 | 现状 | 复用方式 |
|------|------|----------|
| 列目录 | `sessionListDirectory(sessionId, path)`(`sources/sync/ops.ts`)→ CLI `listDirectory` handler,返回 `{name, type:'file'\|'directory'\|'other', size, modified}`,已按「目录在前、名字字典序」排好 | 直接调用,逐层加载 |
| 读文件 | `sessionReadFile(sessionId, path)` → CLI `readFile` handler,返回 base64 | 文件查看器已在用 |
| 文件查看器 | 路由 `app/(app)/session/[id]/file.tsx`,入参 `path`(base64),自带语法高亮 `SimpleSyntaxHighlighter`、git diff、二进制识别、`sessionFileCache` 缓存 | `router.push('/session/${id}/file?path=${btoa(abs)}')` |
| 会话工作目录 / HOME | `session.metadata.path`(cwd)、`session.metadata.homeDir`(HOME) | 作为根 + 上爬边界 |
| 能力中心结构 | `sources/components/rightPanel/`:`SessionCapabilityHub.tsx`(网格 + 详情切换)、`CapabilityBlockCard.tsx`(卡片)、`CapabilityHubDetailView.tsx`(详情列表)、`sessionCapabilityHubModel.ts`(数据模型)、`useSessionCapabilityHub.ts`(hook) | 挂新卡 + 加新详情视图 |

### 关键约束:CLI 的路径安全边界

`packages/happy-cli/src/modules/common/pathSecurity.ts` 的 `validatePath(target, workingDirectory)` 把路径**死锁在工作目录内**:`resolvedTarget` 必须 `=== workingDirectory` 或以 `workingDirectory + sep` 开头,否则 `Access denied`。

`readFile`(handler 第 289 行)、`listDirectory`(375)、`getDirectoryTree`(493)全部走这道校验 → **纯 App 端无法「往上爬到项目外」**,必须改 CLI 才能放宽边界。

## 三、方案总览

分两层改动:**CLI(放宽只读边界到 HOME)** + **App(挂卡 + 目录浏览详情视图)**。

```
┌─ App(happy-app)────────────────────────────────────────────┐
│ 能力中心网格: [会话操作][Skills][快捷指令][图片][📁 文件夹][文件]│
│                                          └─ 原 artifacts 格   │
│   点击 ↓                                                      │
│ SessionFolderBrowserView(新组件)                            │
│   currentPath 状态,起点 = metadata.path                     │
│   sessionListDirectory(id, currentPath) ──RPC──┐            │
│   目录 → 进入下一层 / 上爬(≥ homeDir 才允许)   │            │
│   文件 → router.push('/session/[id]/file?path=…')            │
└──────────────────────────────────────────────┼─────────────┘
                                                 │
┌─ CLI(happy-cli)────────────────────────────── ▼ ───────────┐
│ readFile(289) / listDirectory(375) / getDirectoryTree(493)  │
│   校验边界: workingDirectory ──► HOME(readRoot)             │
│ writeFile(309) / bash / ripgrep 的 cwd: 保持 workingDirectory │
└─────────────────────────────────────────────────────────────┘
```

## 四、CLI 改动(happy-cli)

### 4.1 新增 home-bounded 只读校验

在 `pathSecurity.ts` 增加一个**只放宽 containment 边界、不改相对路径解析基准**的校验函数:

```ts
// 相对路径仍相对 workingDirectory 解析(保持既有调用行为),
// 但「允许访问范围」放宽到 containmentRoot(本功能传 HOME)。
export function validateReadPath(
    targetPath: string,
    workingDirectory: string,
    containmentRoot: string,
): PathValidationResult {
    const resolvedTarget = resolve(workingDirectory, targetPath);
    const root = resolve(containmentRoot);
    if (resolvedTarget !== root && !resolvedTarget.startsWith(root + sep)) {
        return { valid: false, resolvedPath: resolvedTarget,
                 error: `Access denied: Path '${targetPath}' is outside the allowed root` };
    }
    return { valid: true, resolvedPath: resolvedTarget };
}
```

> 之所以保留「相对路径相对 workingDirectory 解析」:App 端所有调用都传**绝对路径**,但保持解析基准不变可避免任何潜在的相对路径调用方被意外改变行为。containment 从 cwd 放宽到 HOME 后,cwd 下的原有路径天然仍合法(cwd ⊆ HOME)。

### 4.2 三个只读 handler 换用新校验

`registerCommonHandlers.ts` 里(`homedir` 已 import):

- `readFile`(289):`validatePath(data.path, workingDirectory)` → `validateReadPath(data.path, workingDirectory, homedir())`
- `listDirectory`(375):同上
- `getDirectoryTree`(493):同上(v1 虽用逐层 listDirectory、暂不用 tree,但一并放宽保持一致,避免以后困惑)

**保持不变**:`writeFile`(309)、`bash`(206)、`ripgrep`/`difftastic` 的 cwd(580/610)仍用 `validatePath(..., workingDirectory)`。

### 4.3 影响面

- `registerCommonHandlers` 同时被会话级(`apiSession.ts`,workingDirectory=`metadata.path`)与机器级(`apiMachine.ts`,workingDirectory=`process.cwd()`)调用。放宽后**两者的只读边界都变成各自机器的 HOME**——一致且符合预期,且本功能只用会话级。
- **安全性**:这是有意放宽一道「手机端只能读当前项目」的边界到「能读 HOME 下任意文件」。写入 / 命令执行不受影响。属于用户已知情同意的取舍(自己的机器 + 自己的手机 + 端到端加密)。
- **部署**:属于原生外的 TS 改动,但**在 CLI 包**,不能走 App 的 OTA。需要 `pnpm --filter happy-cli run build` 重建 `dist/`;只有跑新 CLI 的机器生效(本机 dev-link 重建即可;Mac mini 需更新;npm 版 `@wangjs-jacky/paws` 要等发版其他人才有)。

### 4.4 单测

`pathSecurity.test.ts`(若无则新建)覆盖 `validateReadPath`:
- HOME 内绝对路径 → valid
- HOME 外(如 `/etc/passwd`、上级用户目录)→ invalid
- cwd 下相对路径 → valid(解析基准仍是 cwd)
- `..` 穿越试图逃出 HOME → invalid

## 五、App 改动(happy-app)

### 5.1 能力中心挂新卡(占用 artifacts 格)

`SessionCapabilityHub.tsx`:
- `CapabilityPanelKey` 加 `'folderBrowser'`(类比现有 `'sessionActions'` 这种「非 model.details 驱动」的特殊 key)。
- `BLOCK_ORDER` 里把 `'artifacts'` 替换为 `'folderBrowser'`(位置不变,仍在第 5 格):
  `['sessionActions','skills','quickPrompts','images','folderBrowser','files']`
- `renderBlockIcon` / 卡片:folderBrowser 用 `Ionicons name="folder-outline"`。
- 卡片数据:
  - **大数字** = 会话工作目录下的**顶层条目数**;
  - **预览行** = 工作目录名(`metadata.path` 最后一段)。
  - 该数字通过一个小 hook 懒加载(见 5.3),未加载完显示 `0`(可接受)或占位。
- 点击 → `setSelectedKey('folderBrowser')`,渲染 `SessionFolderBrowserView`。
- **占位态**(`CapabilityHubPlaceholder`,无会话)folderBrowser 卡与其它卡一样 disabled 显示,不触发任何 RPC。

### 5.2 新组件 `SessionFolderBrowserView`(核心新增)

文件:`sources/components/rightPanel/SessionFolderBrowserView.tsx`

Props:`{ sessionId, rootPath, homeDir, onBack }`。

内部状态:
- `currentPath`(初始 = `rootPath`)
- `entries`(当前目录列表)、`isLoading`、`error`

行为:
- 挂载 / `currentPath` 变化 → `sessionListDirectory(sessionId, currentPath)`,写入 `entries`。失败按仓库「永不显示 loading error、直接重试 / 展示可重试」的约定处理(用 `useHappyAction` 或等价重试逻辑)。
- 列表渲染:目录在前、文件在后(RPC 已排序);目录项右侧一个 chevron,文件项用 `FileIcon`。
- 点目录 → `setCurrentPath(join(currentPath, name))` 下钻。
- 点文件 → `router.push('/session/${sessionId}/file?path=${btoa(join(currentPath, name))}')`(与现有「文件」卡一致)。
- 顶部栏:显示当前路径**相对 homeDir 的展示形式**(复用 `formatPathRelativeToHome(currentPath, homeDir)`);左侧「上一层」按钮。
- **上爬边界**:`currentPath === homeDir` 时禁用「上一层」;否则 `setCurrentPath(dirname(currentPath))`。即便越界,CLI 也会兜底返回 Access denied。
- **返回逻辑**(接 panel 的 `registerBackHandler`,类比现有详情视图):
  - `currentPath` 比 `rootPath` 深 → 上一层;
  - `currentPath === rootPath`(或已在 homeDir)→ 调 `onBack()` 退回能力中心首页。

> 注:本视图**不进** `sessionCapabilityHubModel` 的 `details` 管道(那是从消息里预计算的静态列表);它是动态按导航拉取的独立组件,`SessionCapabilityHub` 在 `selectedKey==='folderBrowser'` 分支直接渲染它(类比 `SessionActionsDetailView` 的分支)。

### 5.3 顶层条目数小 hook(卡片数字)

文件:`sources/components/rightPanel/useFolderRootCount.ts`(带注释说明用途)。
- 输入 `sessionId` + `rootPath`;`useEffect` 里 `sessionListDirectory` 拉一次,返回 `entries.length`。
- 用一个模块级 `Map<`${sessionId}::${rootPath}`, number>` 做内存缓存,避免每次滑出面板都重新请求。
- 无会话 / 无 rootPath → 返回 `null`,卡片当作占位。

> **成本提示**:能力中心面板通过右滑频繁打开,该 hook 会在首次挂载时发一次 `listDirectory` RPC(轻量 `readdir`)。加了内存缓存后同一会话只请求一次。若后续觉得多余,可退化为「不显示数字、只放文件夹图标」(需给 `CapabilityBlockCard` 加一个可选隐藏数字的能力)。v1 先按「懒加载 + 缓存」。

### 5.4 i18n

新增 key(9 种语言全补,遵循 `packages/happy-app/CLAUDE.md` i18n 规范,可用 i18n-translator agent):
- `rightPanelCapabilityHub.blocks.folderBrowser`(卡片 & 详情标题,如「文件夹」/「Folder」)
- 详情视图文案:`...folderBrowser.upOneLevel`(上一层)、`...folderBrowser.empty`(空目录)、`...folderBrowser.loading`、`...folderBrowser.error` 等(按实现实际需要)。

> 删掉 `blocks.artifacts` 的**引用**即可;translations 里的 `artifacts` 字符串可保留(无害),避免牵动其它语言文件。

## 六、验收与交付

1. `pnpm typecheck`(happy-app)+ CLI 侧 `pnpm --filter happy-cli run build` 通过。
2. `pathSecurity` 新单测通过。
3. 真机验证(本机 dev-link 重建 CLI 后新开一个会话):
   - 能力中心第 5 格变「文件夹」,数字=项目根条目数;
   - 点进去能逐层浏览;上爬能到 HOME、到 HOME 后「上一层」禁用;
   - 点 `.ts` / `.md` 能打开查看器且语法高亮正常;
   - 点 HOME 下**另一个项目**的文件也能打开(验证边界放宽生效);
   - 试图看 HOME 外(理论上 App 不给入口,可临时构造)→ Access denied 兜底。
4. App 侧改动发 **preview OTA** 给真机验收(`pnpm ota:selfhost:preview`),回复附 `<happy-ota-preview>` 卡片。
5. **CLI 改动不随 OTA 走**,需单独说明「本机已重建 dist,其它机器需更新 CLI 才生效」。

## 七、分支 / worktree

- 开发在 sibling worktree:`../happy--folder-browser`,分支 `folder-browser`(已建)。
- 完成后提 PR 到 `main`(`gh pr create --repo wangjs-jacky/happy --base main --head folder-browser`)。

## 八、未决 / 可延展(非 v1)

- 卡片数字是否值得那次 RPC(见 5.3),可按体验再调。
- 以后若要支持 ComposeHome(建会话前浏览选中文件夹),需另加机器级只读 RPC。
- 目录树整体视图(`getDirectoryTree`)可作为「另一种查看模式」后续加。
- 文件搜索(已有 `sessionRipgrep`)可作为浏览器里的搜索框后续加。
