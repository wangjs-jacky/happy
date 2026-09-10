# Paws Codex 多账号与设备绑定设计

**日期：** 2026-09-10  
**状态：** 已完成对话设计确认，待用户审阅书面稿  
**范围：** Paws Server、Paws CLI、Paws App（PC Web 与移动端共享行为）  
**视觉基线：** 生产 Paws `设备环境` 页面（2026-09-10，Ego Browser 实测）

## 1. 目标

Paws 允许同一个 Paws 用户安全维护多个 Codex OAuth 账号，并为每台设备单独绑定一个默认账号。只有由 Paws 发起的 Codex 进程使用该绑定账号；设备终端直接启动的 Codex 继续使用设备原有的全局登录，二者互不影响。

目标体验：

- 用户在设备终端手动执行一条无参数命令，将当前 Codex 登录上传到 Paws。
- Paws 的设备环境页面展示账号库，并允许逐台设备设置默认 Codex 账号。
- 新建、恢复和分叉 Codex 进程时不出现账号选择项，直接使用设备当时的绑定。
- 账号不可用时失败关闭，不自动消耗其他账号额度，也不退回设备本地账号。

## 2. 已确认的产品决策

1. 采用现有 Paws 服务端加密凭据库的扩展方案，不在首版建设端到端加密保险箱。
2. Paws 持久化多个 Codex 账号；设备只保存账号引用，不保存凭据副本。
3. 上传入口是用户在设备终端手动执行的无参数命令：

   ```bash
   paws codex account upload
   ```

4. 页面提供上述命令的一键复制按钮，用户无需修改账号名称或其他参数。
5. 账号名称由系统自动生成脱敏值，例如 `Codex · A7F2`，上传后可以在 Paws 重命名。
6. 账号只能逐台设备绑定；首版不提供全选、批量应用或设备组。
7. 新建会话页面不显示账号选择器，也不支持单次会话覆盖。
8. 修改设备绑定只影响之后创建、恢复或分叉出的新进程，不切换已经运行的进程。
9. 无绑定、账号失效或账号删除时阻止进程启动，不自动选择备用账号，也不使用设备全局账号。

## 3. 当前系统与可复用能力

当前代码已经具备本设计需要的三项基础能力：

- `ServiceAccountToken` 与 `encryptString()` 可以按 Paws 用户加密保存供应商凭据；当前 OpenAI 记录是每用户单条。
- App 与 daemon 之间已有机器级加密 RPC，服务端只中继密文。
- daemon 的 `prepareCodexHomeWithAuth()` 会创建临时 `CODEX_HOME`，继承安全配置但单独写入权限为 `0600` 的 `auth.json`，因此无需覆盖设备全局 `~/.codex/auth.json`。

当前设备环境页面采用“设备为列、开发工具为行”的矩阵。生产页面实测包含设备总数、在线状态、重新检测、开发工具矩阵和底部更新摘要。新功能沿用该信息架构，不在设置中新建第二套设备管理页面。

## 4. 范围与非目标

### 4.1 首版包含

- 多个 Codex OAuth 账号的加密保存、脱敏列表、重命名、更新与删除。
- 无参数上传命令及其确认、校验、去重和更新逻辑。
- 设备环境中的账号库和逐台设备默认账号绑定。
- 新建、恢复与分叉进程的自动凭据授权与临时注入。
- 单次短时授权、凭据刷新回写、乐观并发保护和脱敏审计。
- 旧版单一 OpenAI 凭据的兼容迁移。
- PC Web 和移动端一致的账号与绑定语义。

### 4.2 首版不包含

- 批量设置设备、设备组或账号自动下发。
- 新建会话时选择或临时覆盖账号。
- 自动轮换、额度均衡、故障切换、余额或消费统计。
- 读取后覆盖设备全局 `auth.json`，或把账号持久复制到设备。
- Paws 页面内的 OpenAI OAuth 登录。
- Claude、Gemini 或其他供应商的多账号能力。
- Tauri 桌面支持。

## 5. 数据模型

### 5.1 CodexAccountProfile

为 Codex 多账号新增独立实体，不继续把 profile 塞入 `ServiceAccountToken.vendor` 字符串中。

| 字段 | 含义 |
|---|---|
| `id` | Paws 生成的不可猜 UUID |
| `accountId` | 所属 Paws 用户 |
| `displayName` | 用户可修改的脱敏名称 |
| `externalAccountFingerprint` | 对 OpenAI Account ID 计算的服务端 keyed hash，用于同用户去重 |
| `credential` | 完整 Codex `auth.json` 的加密字节 |
| `credentialVersion` | 单调递增版本，用于条件更新 |
| `status` | `available`、`needs-refresh`、`invalid` |
| `createdAt` / `updatedAt` | 生命周期时间 |
| `lastValidatedAt` | 最近一次结构或运行验证时间，可空 |

约束：

- `(accountId, externalAccountFingerprint)` 唯一。
- `displayName` 在单个 Paws 用户内唯一；自动名称冲突时追加短序号。
- 加密路径包含 Paws 用户 ID 和 profile ID，防止跨用户或跨 profile 密文替换。
- 列表接口绝不返回 `credential`、完整 OpenAI Account ID、邮箱或 JWT claims。

### 5.2 Machine Codex Binding

每台设备保存一个可空的 `defaultCodexAccountProfileId`。它属于 Paws 账号侧的设备配置，而不是 daemon 本地配置，因此离线设备也能被设置。

写入时必须验证：

- 设备属于当前 Paws 用户；
- profile 属于同一 Paws 用户且未删除；
- 请求带当前配置版本，避免多端同时编辑时静默覆盖。

设备列表只返回 profile ID 与脱敏展示信息，不返回凭据。

### 5.3 Session Audit Snapshot

会话元数据只记录实际启动使用的 `codexAccountProfileId`、当时的脱敏名称快照与 `credentialVersion`。这用于问题定位和审计，不用于后续取凭据，也不包含 secret。

## 6. CLI 上传流程

命令：

```bash
paws codex account upload
```

执行流程：

1. 确认当前设备已登录 Paws；未登录时给出 `paws auth login` 指引并退出。
2. 通过现有 `resolveCodexHome()` 解析当前生效的 `CODEX_HOME`，只读取其 `auth.json`。
3. 拒绝符号链接越界、非普通文件、超出大小上限、非法 JSON、缺少 OAuth 必要字段或缺少 OpenAI Account ID 的输入。
4. 从本地内容生成脱敏摘要，只显示自动名称预览和“将上传到哪个 Paws 账号”；不显示邮箱、JWT、Token 或完整 Account ID。
5. 要求交互式确认。非交互环境默认拒绝，首版不提供 `--yes` 绕过。
6. 通过认证 HTTPS API 上传完整 JSON；请求和响应日志必须做字段级脱敏。
7. 服务端验证严格 schema、大小和归属，计算 keyed fingerprint：
   - 同 fingerprint 已存在：条件更新原 profile，并递增 `credentialVersion`；
   - 不存在：创建新 profile 和自动脱敏名称。
8. CLI 只输出 profile 的脱敏名称、状态和 Paws 页面入口。

命令不接收 Token、文件路径或账号名称参数，避免 secret 进入 shell history，也保证 Paws 页面中的复制指令无需用户编辑。

## 7. 设备环境交互

### 7.1 账号库

设备环境头部状态下方、开发工具矩阵上方新增“Codex 账号”卡片：

- 空状态显示用途说明、上传命令和复制按钮。
- 非空状态显示账号名称、`可用 / 需更新 / 已失效` 状态、更新时间，以及重命名和删除入口。
- 账号列表只使用脱敏示例，不显示邮箱和 Account ID。
- 复制成功给出短暂的就地反馈，不弹出阻断式对话框。
- 上传账号不会自动修改任何设备绑定。

### 7.2 逐台绑定

在开发工具矩阵之前新增“Codex 默认账号”行，与现有设备列严格对齐：

- 每个单元格显示当前 profile 名称与状态。
- 点击单元格打开单选菜单，选择一个账号或“未绑定”。
- 离线设备仍可编辑；这是服务端配置，不要求 daemon 在线。
- 不提供跨列全选、复制到其他设备或批量应用。
- 绑定成功后只更新对应设备单元格，不触发环境扫描。

### 7.3 新建、恢复与分叉

- 新建会话 UI 不增加任何账号控件。
- Codex 进程启动前自动读取目标设备当前绑定。
- 绑定可用时继续；未绑定或不可用时终止启动，并提供跳转设备环境的明确操作。
- Claude、Gemini、OpenCode 等非 Codex agent 不读取该绑定。
- 已经运行的 Codex 进程继续使用启动时得到的临时凭据。

## 8. 单次授权与启动数据流

为避免把长期凭据暴露给 App 前端或持久复制到设备，启动使用一次性授权：

1. App 请求启动 Codex 进程，只提交目标 machine ID 和正常的会话参数。
2. Server 读取该设备当前的 profile 绑定，验证 profile 状态后签发一次性 grant。
3. grant 绑定 Paws 用户、machine ID、profile ID、credentialVersion 和短过期时间；服务端只保存 grant 摘要。
4. App 将 grant 通过现有机器加密 RPC 发送给 daemon，前端永远拿不到 Codex auth JSON。
5. daemon 使用自己的 Paws 身份兑换 grant；Server 原子标记已兑换并返回解密后的 auth JSON。
6. daemon 调用 `prepareCodexHomeWithAuth()` 创建临时目录，将该目录作为新 Codex 进程的 `CODEX_HOME`。
7. daemon 把实际使用的 profile ID 和 credentialVersion 作为脱敏结果写入会话元数据。

grant 必须满足：

- 仅可兑换一次；
- 仅绑定设备可兑换；
- profile 删除、失效、绑定改变或 credentialVersion 改变后不可兑换；
- 过期后不可恢复；重试必须重新获取 grant；
- 不得出现在普通日志、错误详情或遥测属性中。

## 9. 凭据刷新与并发

Codex 可能在临时 `auth.json` 中轮换 access token 或 refresh token。daemon 观察到凭据文件发生有效变化后：

1. 重新执行严格 schema 和大小校验；
2. 使用启动时的 `credentialVersion` 条件回写同一 profile；
3. 服务端仅在版本仍匹配时接受并递增版本；
4. 版本冲突时不得用旧会话覆盖新凭据；daemon 读取最新 profile 状态并将本次回写标记为已跳过；
5. 回写失败不能把 secret 写入错误或日志。

删除 profile 后不再接受回写，也不再签发 grant。已经运行的进程不会被强制终止，其临时目录按现有会话清理生命周期处理。

## 10. 删除、迁移与兼容

### 10.1 删除

删除仍被设备引用的 profile 时，确认框列出受影响设备的脱敏名称。确认后事务性完成：

- 标记或删除 profile；
- 清除相关设备绑定；
- 使所有未兑换 grant 失效；
- 保留不含 secret 的审计事件。

### 10.2 旧单账号迁移

现有 `ServiceAccountToken.vendor = openai` 记录按用户惰性迁移：

- 首次读取账号库时验证并创建一个 profile；
- 成功后保留迁移标记，重复执行幂等；
- 为避免升级后原有远程 Codex 流程突然不可用，已有设备继续引用迁移 profile；
- 之后所有修改仍只能逐台完成；
- 迁移失败时保留旧记录并显示“需要重新上传”，不得删除唯一凭据。

迁移完成并经过一个兼容周期后，旧 endpoint 才能弃用；首版不立即移除。

## 11. API 边界

建议新增独立的 `/v1/codex-accounts` 资源：

- `GET /v1/codex-accounts`：返回脱敏 profile 列表。
- `POST /v1/codex-accounts/upload`：CLI 创建或更新当前账号。
- `PATCH /v1/codex-accounts/:id`：重命名。
- `DELETE /v1/codex-accounts/:id`：删除并清理引用。
- `PUT /v1/machines/:machineId/codex-account`：逐台设置或清除绑定。
- `POST /v1/codex-session-grants`：按设备绑定签发单次授权。
- `POST /v1/codex-session-grants/:grant/redeem`：绑定 daemon 兑换。
- `PUT /v1/codex-accounts/:id/credential`：daemon 用版本条件回写刷新凭据。

所有请求使用严格 Zod schema、字段上限和未知字段拒绝。secret API 不与列表 API 复用响应类型。

## 12. 错误处理与用户文案

| 情况 | 行为 |
|---|---|
| 当前设备没有 Codex 登录 | CLI 退出并提示先执行 Codex 登录 |
| `auth.json` 非法或过大 | 拒绝上传；不回显内容 |
| 设备未绑定 | 阻止启动，提供“前往设备环境” |
| profile 需更新或失效 | 阻止启动，提示重新执行上传命令 |
| 设备离线 | 保留绑定；启动按现有离线错误处理 |
| grant 过期或已兑换 | 失败关闭；重新发起启动生成新 grant |
| 绑定在签发后改变 | 旧 grant 失效，不静默切换 |
| 刷新版本冲突 | 保留服务端较新版本，旧会话不覆盖 |
| 删除仍被引用的 profile | 二次确认并列出受影响设备 |

## 13. 安全与隐私要求

- secret 不得进入 URL、命令参数、shell history、React state 持久化、分析事件或普通日志。
- API 与测试使用固定假 Token；生产 Token 不进入 fixture、截图、HTML 标注稿或设计文档。
- 账号指纹使用服务端 keyed hash，不能直接保存 OpenAI Account ID 的普通哈希。
- grant 使用高熵随机值，数据库只存摘要，并限制生命周期、用途、用户和设备。
- 上传、重命名、删除、绑定、授权签发、兑换与刷新只记录 profile ID、machine ID、版本、结果和时间。
- 公开 HTML 标注稿使用脱敏设备名与示例账号，不嵌入生产截图或真实环境数据。

## 14. 验收标准

### 14.1 功能

- 连续上传两个不同账号后，账号库同时保留两份有效 profile。
- 重复上传同一 OpenAI Account ID 只更新原 profile，`credentialVersion` 递增。
- 两台设备分别绑定不同 profile 后，Paws 发起的 Codex 进程使用各自绑定。
- 新建会话页面没有账号选择器。
- 修改绑定不影响运行中进程；之后的新建、恢复和分叉进程使用新绑定。
- 离线设备可以设置绑定，恢复在线后下一次启动生效。
- profile 删除后相关设备显示未绑定，不能再创建新的 Codex 进程。

### 14.2 隔离与安全

- 启动前后设备全局 `~/.codex/auth.json` 的内容哈希一致。
- grant 不能跨设备、重复兑换、过期兑换或在绑定改变后兑换。
- App 前端网络层和持久化中不存在原始 Codex credential。
- 并行刷新时旧 credentialVersion 不能覆盖新版本。
- 日志、错误、列表 API 和 UI 中扫描不到 access token、refresh token、ID token、邮箱或完整 Account ID。

### 14.3 测试与视觉

- Server：模型约束、加密路径、去重、迁移、grant 原子兑换、删除事务与刷新 CAS 测试。
- CLI：路径解析、文件防护、schema、交互确认、脱敏输出和上传幂等测试。
- App：账号库、复制指令、逐台绑定、离线设备、失效状态和启动阻断测试。
- 集成：两 profile / 两设备启动、恢复、分叉，以及全局 `auth.json` 不变测试。
- Ego Browser：在生产 Paws 页面确认真实设备环境视觉基线；标注稿完成后在同一 Ego 任务空间验证桌面布局、交互与无外部依赖。
- HTML：单文件、自包含、响应式、键盘可用、支持 reduced motion，并明确标注所有新增界面位置。

## 15. HTML 标注稿契约

标注稿以生产设备环境页面为视觉基线，保持：

- 居中内容区、浅色暖白背景、细分隔线和低密度矩阵；
- 顶部设备数量、在线状态、检测时间与重新检测操作；
- 设备为列、能力为行的核心结构；
- 底部状态摘要。

新增部分：

1. 开发工具矩阵上方的 Codex 账号库；
2. 无参数命令及一键复制按钮；
3. 逐台设备 Codex 默认账号行；
4. 未绑定和账号失效的失败关闭状态。

标注稿只使用公开、脱敏的示例数据，并提供正常、未绑定和账号失效三种可切换状态。

## 16. 发布边界

本设计与标注稿不授权实现、推送、PR、合并、生产 Web 部署、OTA 或 npm 发布。进入实现前必须另行完成实施计划并获得执行授权。
