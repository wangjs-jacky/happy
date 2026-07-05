# Happy 内网自托管实操部署手册

> 目标：在**公司内网**部署一套自己的 happy-server，让团队的 CLI（电脑端）与 App（手机/网页端）全部连到内网服务器，业务数据不出内网。
>
> 适用版本：本 fork（默认服务器地址 `https://47.115.228.20:8443`）。所有结论均对照源码核实，关键出处标注 `file:line`。

---

## 〇、先理解架构（30 秒）

```
   手机/网页 App            内网服务器(本手册部署)            开发者电脑(happy CLI)
  ┌──────────┐  WS+HTTP   ┌────────────────────┐   WS    ┌──────────────┐
  │ happy-app │ ───加密──→ │   happy-server     │ ←加密── │ happy daemon │
  │  (遥控器) │ ←──────── │  (盲中继, PGlite)  │ ──RPC─→ │  + 会话进程  │
  └──────────┘            └────────────────────┘         └──────────────┘
```

- **服务器是「盲中继」**：端到端加密下，服务器看不到任何会话内容，只转发加密 blob。换内网地址不影响加密。
- **唯一硬公网依赖**：手机推送走 `https://exp.host`（Expo → APNs/FCM），`packages/happy-server/sources/app/push/pushSend.ts:7`。纯隔离内网下推送会失效，但**核心远程操控走 WebSocket 长连，不依赖推送**。

---

## 一、部署方案选择

| 方案 | 命令 | 适用 | 依赖 |
|------|------|------|------|
| **A. 单机一键** | `happy server` | 自己一个人本机测试 | 无（CLI 自带） |
| **B. Docker Standalone**（本手册主推） | `docker compose up -d` | 团队共享的内网服务器 | 仅 Docker |
| C. 完整生产 | `Dockerfile.server` + 外部 PG/Redis/MinIO | 大规模、高可用 | PostgreSQL+Redis+S3 |

> 方案 A 已在 CLI 内置：`packages/happy-cli/src/commands/server.ts:62` —— 它用内嵌 PGlite 起服务、自动生成 master secret、还能内嵌 webapp，并可写回 `~/.happy/settings.json` 的 serverUrl。单人验证最快。
>
> **团队内网选方案 B**：单容器、内嵌 PGlite（嵌入式 Postgres）、本地文件存储、无需 Redis。下面以 B 为主线。

---

## 二、前置条件

- 一台内网服务器（Linux x86_64 或 arm64），装好 **Docker + Docker Compose v2**。
- 内网固定 IP 或内网 DNS 域名，例：`192.168.1.100` 或 `happy.corp.internal`。
- 开放端口 `3005`（API + WebSocket 同端口）。
- 服务器能临时联公网用于 **构建镜像**（拉 node 基础镜、装依赖）。构建完成后**运行时不需要公网**（除非要推送）。

---

## 三、构建镜像

在仓库根目录（含 `Dockerfile`）执行：

```bash
cd /path/to/happy
docker build -f Dockerfile -t happy-server:intranet .
```

> 该 `Dockerfile` 即 standalone 版：三阶段构建，运行阶段 `node:20-slim`，`EXPOSE 3005`，`VOLUME /data`，启动时先 `migrate` 再 `serve`（`Dockerfile` CMD 已核实）。
>
> 若内网服务器无法联公网，可在能联网的机器上 `docker save happy-server:intranet | gzip > happy.tar.gz`，拷进内网后 `docker load`。

---

## 四、生成 master secret

`HANDY_MASTER_SECRET` 用于**鉴权 token 生成**和**服务端第三方 token 加密**（`packages/happy-server/sources/standalone.ts:116-118` 强制要求；缺失直接报错退出）。生成一个强随机值并妥善保管：

```bash
openssl rand -hex 32
# 例：c3f1...（64 位十六进制），复制备用
```

> ⚠️ 一旦上线**不要更换**：换了之后所有已签发 token 失效、已加密的第三方 token 无法解密（但用户会话内容因走客户端密钥，不受影响）。

---

## 五、docker-compose.yml

在内网服务器上新建 `docker-compose.yml`：

```yaml
services:
  happy-server:
    image: happy-server:intranet
    container_name: happy-server
    restart: unless-stopped
    ports:
      - "3005:3005"
    volumes:
      - ./data:/data            # PGlite 数据库 + 本地文件存储，务必持久化
    environment:
      NODE_ENV: production
      PORT: "3005"
      HOST: "0.0.0.0"
      HANDY_MASTER_SECRET: "粘贴第四步生成的值"
      # DATA_DIR / PGLITE_DIR 在镜像里已默认 /data 与 /data/pglite，无需重复设
      # 不配 ELEVENLABS_API_KEY / REVENUECAT_API_KEY → 自动禁用语音
      # 不配 GITHUB_* → 自动禁用 GitHub 连接
      METRICS_ENABLED: "true"   # 可选：Prometheus 指标
```

启动：

```bash
docker compose up -d
docker compose logs -f happy-server   # 看到 migrate 完成 + 监听 3005 即成功
```

**最小必填环境变量只有两个**：`HANDY_MASTER_SECRET` 和 `PORT`（`packages/happy-server/CLAUDE.md` 与 `standalone.ts` 一致确认）。

### 可选环境变量速查

| 变量 | 作用 | 出处 |
|------|------|------|
| `HOST` | 监听地址，默认 `0.0.0.0` | `standalone.ts:122` |
| `DATABASE_URL` | 设了就用外部 Postgres 替代 PGlite | `standalone.ts:212` |
| `REDIS_URL` | 跨进程 pub/sub，单容器**不需要** | `socket.ts` |
| `S3_HOST`/`S3_*` | 用 MinIO 替代本地文件存储 | `storage/files.ts` |
| `HAPPY_STATIC_DIR` | 让服务端同时托管 webapp 静态站 | `standalone.ts:149-163` |
| `HAPPY_INJECT_HTML_CONFIG` | 注入前端配置(如 serverUrl) | `standalone.ts:125-131` |
| `METRICS_ENABLED`/`METRICS_PORT` | Prometheus 指标 | `monitoring/metrics.ts:18-19` |

---

## 六、（可选）让服务端同时托管网页版 App

如果希望同事直接用浏览器访问内网网页版（而不是装手机 App），可把 webapp 构建产物挂进容器：

```bash
# 在仓库根构建 webapp 静态产物（产物目录因脚本而定，常见 packages/happy-app/dist）
pnpm --filter happy-app ...   # 参照仓库 webapp 构建脚本

# compose 里挂载并指向它
#   volumes:  - ./webapp:/repo/packages/happy-server/webapp
#   或 environment: HAPPY_STATIC_DIR: /webapp  并挂载 - ./webapp:/webapp
```

服务端 `findStaticDir()` 会自动探测 `HAPPY_STATIC_DIR` → `cwd/webapp`，找到 `index.html` 即托管（`standalone.ts:149-163`）。同时用 `HAPPY_INJECT_HTML_CONFIG='{"serverUrl":"http://192.168.1.100:3005"}'` 把内网地址注入前端，浏览器打开即连内网。

---

## 七、客户端配置：把三端指向内网

服务器地址解析优先级（核实自源码）：**环境变量 > 本地配置 > 默认值**。

### 7.1 CLI（开发者电脑）

`packages/happy-cli/src/configuration.ts` 同时有 `serverUrl` 和 `webappUrl` 两条链，**两个都要指内网**，否则鉴权时会去打开生产 webapp：

```bash
# 方式一：环境变量（临时/单会话）
export HAPPY_SERVER_URL=http://192.168.1.100:3005
export HAPPY_WEBAPP_URL=http://192.168.1.100:3005
happy        # 启动会话，扫码鉴权

# 方式二：写进 ~/.happy/settings.json（持久）
# { "serverUrl": "http://192.168.1.100:3005", "webappUrl": "http://192.168.1.100:3005" }
```

> daemon 给每个新会话 spawn 新进程读环境，改完**新开会话**即生效。

### 7.2 手机 App

`packages/happy-app/sources/sync/serverConfig.ts:10-15` 解析顺序：App 内自定义 URL(MMKV) > `__HAPPY_CONFIG__.serverUrl` > `EXPO_PUBLIC_HAPPY_SERVER_URL` > 默认值。

- **最简单**：打开 App → 设置里「自定义服务器」填 `http://192.168.1.100:3005`（写入 MMKV，跨登出保留）。
- **构建期固化**：`EXPO_PUBLIC_HAPPY_SERVER_URL=http://192.168.1.100:3005` 再 build。

### 7.3 网页 App

用第六步的 `HAPPY_INJECT_HTML_CONFIG` 注入，或浏览器内自定义服务器设置同手机端。

> ⚠️ **HTTP 明文注意**：示例用 `http://`。iOS 对非 HTTPS 有 ATS 限制（`packages/happy-app/app.config.js` 仅对本地开发放行）。内网正式用建议给服务器配一张**内网 CA 签发的证书**走 HTTPS，或在 happy-server 前加一层 Nginx/Caddy 反代做 TLS。

---

## 八、验证步骤（务必逐项打勾）

```bash
# 1) 健康检查（端点已核实存在：app/api/utils/enableMonitoring.ts:27）
curl -i http://192.168.1.100:3005/health
#   期望 HTTP 200

# 2) 指标（可选）
curl -s http://192.168.1.100:3005/metrics | head

# 3) CLI 连通 + 鉴权
export HAPPY_SERVER_URL=http://192.168.1.100:3005
export HAPPY_WEBAPP_URL=http://192.168.1.100:3005
happy
#   终端应显示二维码；用已指向内网的 App 扫码 → 完成 challenge-response 鉴权

# 4) 远程操控闭环
#   手机 App 进入该会话 → 发一条指令(如"列出当前目录") → 电脑端应执行并回传结果

# 5) 验证端到端加密(可选, 在服务器上)
docker compose exec happy-server sh -c 'ls -la /data'
#   会话内容在 PGlite 中是加密 blob, 服务器无法读明文 → 符合预期
```

鉴权流程参考（`docs/api.md`）：CLI `POST /v1/auth/request` 创建请求 → App 扫码 `POST /v1/auth/response` 批准 → 服务端用 `HANDY_MASTER_SECRET` 派发 Bearer token。

---

## 九、内网外部依赖清单（决定能否完全隔离）

| 能力 | 内网可行 | 说明 / 处置 |
|------|---------|------------|
| 数据库 | ✅ | 内嵌 PGlite，零外部依赖 |
| 文件存储 | ✅ | 本地 `/data`，或自建 MinIO |
| 实时同步/RPC | ✅ | WebSocket(Socket.IO)，纯内网 |
| 端到端加密/鉴权 | ✅ | 客户端密钥，与服务器位置无关 |
| **手机推送** | ❌ | 硬编码 `exp.host`（`push/pushSend.ts:7`）。隔离内网下：禁用（App 前台/轮询）或改造自建推送(Ntfy/UnifiedPush) |
| 语音(ElevenLabs/RevenueCat) | ➖ | 不配 env 即禁用 |
| GitHub 连接 | ➖ | 不配 `GITHUB_*` 即禁用 |

**结论**：除手机推送外，**可 100% 内网化**。推送是唯一需要权衡的点，且不影响核心远程操控。

---

## 十、常见问题

| 现象 | 排查 |
|------|------|
| 容器启动即退出 | 八成是没设 `HANDY_MASTER_SECRET`（`standalone.ts:117` 抛错）。看 `docker compose logs` |
| CLI 扫码后卡住/鉴权失败 | 检查 `HAPPY_SERVER_URL` **和** `HAPPY_WEBAPP_URL` 是否都指向内网；`/v1/auth/response` 404 多为服务重启 |
| App 连不上 | iOS ATS 拦 http → 上 HTTPS 反代；确认 App 自定义服务器 URL 已保存 |
| 收不到通知 | 内网无法到 `exp.host`，属预期。改用前台/轮询或自建推送 |
| 数据丢失 | 确认 `./data` 卷已持久化挂载，别用匿名卷 |

---

## 附：关键源码索引

| 主题 | 文件 |
|------|------|
| Standalone 启动/必填 env | `packages/happy-server/sources/standalone.ts:111-163` |
| 健康检查端点 | `packages/happy-server/sources/app/api/utils/enableMonitoring.ts:27` |
| CLI serverUrl/webappUrl 解析 | `packages/happy-cli/src/configuration.ts`（URL precedence 段） |
| CLI 一键自托管 `happy server` | `packages/happy-cli/src/commands/server.ts:62` |
| App serverUrl 解析 | `packages/happy-app/sources/sync/serverConfig.ts:10-15` |
| 推送硬依赖 exp.host | `packages/happy-server/sources/app/push/pushSend.ts:7` |
| 根 Standalone 镜像 | `Dockerfile` |
