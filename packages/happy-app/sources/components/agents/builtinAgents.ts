import type { Machine } from '@/sync/storageTypes';
import type { AgentLauncher } from './launchAgent';

export const APP_BUILDER_AGENT_ID = 'builtin:app-builder';

const APP_BUILDER_PROMPT = `我要从 0 到 1 生成一款独立 App。请按 Paws/Happy 自托管栈的成熟工作流来做，不要让我反复补充基础约束。这个任务的完成标准不是“写出几个页面”，而是把产品定义、独立仓库、可运行 App、Preview/Production APK、GitHub Release、自托管 OTA、验证记录和 Obsidian 沉淀全部闭环。

先读知识库：
- 先解析当前 Obsidian 仓库，检索 Happy/Paws、自托管 Expo OTA、FC、OSS、GitHub Release、GPT Image 2、Android APK、Tide Focus/潮汐专注、类似独立 App 项目的笔记。
- 必读 Tide Focus 经验：projects/tide-focus/index、architecture-and-release、development-retrospective-2026-07-06、verification-2026-07-06。吸取其中的坑：不要先堆功能；先做 spec/用户旅程/信息架构/状态机/点击矩阵；GPT Image 2 资产要前置；preview/prod gate 要硬化；版本与 OTA 入口要可见；发布验证要记录。
- 如果有同类项目笔记，先读再做；如果没有，记录知识缺口。

第 0 阶段：和我确认范围，不能跳过：
- App 名称、中文名/英文名、包名、slug、scheme、GitHub 仓库名、首个版本号、runtimeVersion。
- 目标用户、核心使用场景、首屏体验、主导航、最小可用功能、是否需要登录/后端/通知/支付/图片/音频/地图/摄像头等原生能力。
- 发布目标：是否需要 preview APK、production APK、preview OTA、production OTA、GitHub Release、README、隐私/权限说明。
- 成本边界：默认复用已有 Happy OTA FC + OSS；不要新建数据库、队列、FC、OSS bucket 或付费服务，除非我明确确认。
- 敏感信息边界：release keystore、OSS/FC AccessKey、签名密码只放本机环境或 GitHub Secrets，禁止写入仓库和 Obsidian。

第 1 阶段：产品与设计工件先行：
- 先产出 PRD/spec：目标、非目标、用户旅程、信息架构、主流程、状态机、失败态、权限说明、验收标准。
- 产出点击矩阵：每个可见卡片/按钮的目的、行为、状态变化、空态、回退路径、验证方式。禁止假入口。
- 对 UI 先做竞品/风格语言提炼。SaaS/工具要克制高效；内容型/生活方式 App 要沉浸、留白、情绪流和内容货架。不要用卡片堆功能冒充产品。
- 使用 GPT Image 2 作为前置资产管线：先写 prompt 和视觉约束，生成 App icon、adaptive icon、splash、首屏/场景图、空状态图、营销/Release 图。prompt 文件和最终资产都要入库并在 Obsidian 记录。

第 2 阶段：建立独立工程：
- 默认在 ~/jacky-github 下创建独立仓库，不要做成 Happy 主仓库里的临时 demo。
- 推荐移动 App 使用 Expo/React Native/Expo Router/TypeScript/Expo Updates；如果更适合 Web/Tauri/后端，先说明取舍并确认。
- 建立 AGENTS.md/CLAUDE.md，写清命令、架构、开发规则、发布流程、OTA runtime/channel、Obsidian 索引路径。
- 初始工程要包含 README、package scripts、typecheck、基础测试或可验证脚本、应用配置、权限最小化、gitignore、资产目录、文档目录。

第 3 阶段：实现真实可用体验：
- 第一屏必须是可实际使用的产品体验，不是 landing page 或说明页。
- 每个主流程都要形成闭环：输入/选择 → 状态变化 → 持久化/反馈 → 历史或结果可见。
- 如果有本地音频、图片、通知、文件、网络等能力，必须验证资源存在、权限最小、失败态可见。
- 版本/OTA/调试入口要有明确位置。Preview 包可以有全局调试入口；production 包不要让调试入口干扰主体验。

第 4 阶段：发布体系必须完整：
- Android 至少支持 APP_ENV=preview 和 APP_ENV=production 两种构建语义。preview 和 production 的 package/channel/name 要清晰区分；production 读取 production channel，preview 读取 preview channel。
- runtimeVersion 必须为该 App 独立命名，避免污染 Happy/Paws 主 App，例如 app-slug-1。只改 JS/资产可 OTA；新增原生依赖、权限、签名、package、runtimeVersion 变化必须重新打 APK。
- 自托管 OTA 默认复用 Happy FC endpoint 和 OSS bucket，但路径必须按 platform/runtime/channel 隔离：manifests/android/<runtime>/<channel>/latest.json 和 updates/android/<runtime>/<stamp>/。
- 如需改 FC 服务端代码，必须单独部署 FC 并 live probe；发布 preview/production OTA 只上传 OSS manifest/bundle，不会自动部署 FC。
- GitHub Actions 至少覆盖 typecheck 和 preview OTA；production OTA 只允许在明确合并/发布 gate 后触发。若 workflow 文件推送被 token scope 拒绝，改用 SSH push 并用 gh api/远端状态验证。
- GitHub Release 必须包含 production APK；如果我要求，也包含 preview APK。命名、tag、asset 名、SHA256、下载 URL 都要记录。不要把 APK commit 进仓库。

第 5 阶段：发布前 release-doctor：
- 检查 git 状态、分支、远端、tag 规划、GitHub repo 是否存在。
- 检查 Node/pnpm、Expo、Java 17、Android SDK/local.properties、build-tools、NDK、Gradle 可用。
- 检查 release keystore 环境变量存在且不入库；后续升级必须使用同一个 keystore。
- 检查 APP_ENV、package、channel、runtimeVersion、updates.url、权限列表、blocked permissions。
- 检查 OSS/FC CLI 与 GitHub Secrets：ALIYUN_OSS_ACCESS_KEY_ID、ALIYUN_OSS_ACCESS_KEY_SECRET 等是否具备发布能力。

第 6 阶段：验证和 gate：
- 本地至少运行 pnpm typecheck、相关单元测试、git diff --check、expo install --check（如适用）。
- APK 验证：Gradle release 构建、apksigner verify、aapt dump badging、aapt dump permissions、SHA256、文件大小、GitHub Release asset HEAD 200。
- OTA 验证：expo export、publish preview OTA、GET latest manifest，核对 channel/runtime/updateId/createdAt/launchAsset；HEAD launchAsset 200 且 Content-Type 正确。
- Preview gate：preview APK 或 preview OTA 通过后，做 ETO 评审。E=按 spec 打分；T=静态检查/测试/smoke/截图；O=对抗评审，找假入口、竞品差距、失败路径、权限和发布风险。
- Production gate：production APK/OTA 之前必须先通过 preview 验收；如需真机、模拟器、dev server、生产发布或 OTA，请先明确告知命令和影响，并取得我确认。

第 7 阶段：Obsidian 沉淀是交付物：
- 新建或更新 wiki/projects/<app-slug>/index.md、architecture-and-release.md、verification-<date>.md、development-retrospective 或 troubleshooting 文档。
- 记录 GitHub Repo、Release、APK 下载 URL、APK SHA256、runtimeVersion、preview/production updateId、manifest URL、workflow URL、FC/OSS 拓扑、构建命令、验证命令、残余风险。
- 记录所有坑：Gradle/JDK/Android SDK、GitHub token workflow scope、OSS/FC 权限、OTA channel/runtime、preview dirty worktree、真机未验等。
- 更新项目 CLAUDE.md 的 Obsidian 索引段，确保后续修 bug 时能先读项目笔记。

执行权限：
- 可以使用本地文件系统、安装依赖、运行静态检查和测试。
- 可以按需使用 GPT Image 2 生成图标、插画、场景、空状态、营销素材。
- 可以准备 FC/OSS/OTA/GitHub Release 发布脚本，但实际启动 dev server、模拟器、真机、部署 FC、发布 APK Release、发布 production OTA 前，必须说明命令、目标和风险并等待确认。

交付要求：
- 边做边给我可验证的中间结果。
- 完成后给出 App 入口、GitHub repo、Release/APK URL、preview/production OTA manifest、运行/构建/测试命令、已执行检查、未执行验证及原因、Obsidian 沉淀位置。
- 如果无法完成完整发布闭环，必须明确卡在哪一项，以及下一条最小可执行命令。`;

const APP_BUGFIX_PROMPT = `我要修复这款 App 的问题。请先从 Obsidian 中读取该项目的架构、历史 QA、部署和验证记录，再定位问题。不要只看当前代码。

要求：
- 先解析项目对应的 Obsidian 索引，必读 architecture-and-release、verification、development-retrospective、troubleshooting 或最近 QA。若是 Tide Focus/潮汐专注，先读 projects/tide-focus 的三篇核心笔记。
- 判断问题属于产品 spec、视觉资产、交互假入口、本地状态、原生权限、APK 签名、OTA channel/runtime、FC/OSS、GitHub Release、设备环境还是代码 bug。
- 先复现或用日志/测试/manifest/Release HEAD/截图/点击矩阵锁定根因，不要猜。
- 修复时保持独立 App 的边界，不要把临时 workaround 混进无关项目。
- 如果涉及 Happy 自托管、FC、OSS、OTA、GPT Image 2 素材、GitHub Release、APK 或本地服务，先查已有沉淀再操作。
- 修完后运行相关静态检查/测试；如果涉及 OTA，先发 preview 并核对 manifest；production OTA 或 APK Release 前先确认。
- 把根因、修复、验证命令、updateId/manifest/Release URL、残余风险写回 Obsidian verification 或 troubleshooting 文档，并更新项目 CLAUDE.md 索引段。`;

function getMachineName(machine: Machine | undefined): string {
    if (!machine) return '';
    return machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id;
}

function pickMachine(machines: Machine[], preferredMachineId?: string | null): Machine | undefined {
    if (preferredMachineId) {
        const preferred = machines.find((m) => m.id === preferredMachineId);
        if (preferred) return preferred;
    }
    return machines.find((m) => m.active) ?? machines[0];
}

export function createAppBuilderAgent(options: {
    machines: Machine[];
    preferredMachineId?: string | null;
    preferredPath?: string | null;
    title: string;
    presetBuildLabel: string;
    presetBugfixLabel: string;
}): AgentLauncher | null {
    const machine = pickMachine(options.machines, options.preferredMachineId);
    if (!machine) return null;

    return {
        id: APP_BUILDER_AGENT_ID,
        name: options.title,
        glyph: 'A',
        color: '#0F766E',
        machineId: machine.id,
        path: options.preferredPath || machine.metadata?.homeDir || '~',
        presets: [
            { label: options.presetBuildLabel, prompt: APP_BUILDER_PROMPT },
            { label: options.presetBugfixLabel, prompt: APP_BUGFIX_PROMPT },
        ],
        agentType: 'codex',
        permissionMode: 'yolo',
        modelMode: 'default',
        effortLevel: null,
        builtin: true,
    };
}

export function getAgentSubtitle(agent: AgentLauncher, machine: Machine | undefined, machineMissing: string): string {
    const machineLabel = machine ? getMachineName(machine) : machineMissing;
    return `${machineLabel} · ${agent.path}`;
}
