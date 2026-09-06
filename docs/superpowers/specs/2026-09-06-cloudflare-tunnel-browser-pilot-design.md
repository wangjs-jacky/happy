# Paws Cloudflare Tunnel 浏览器试用设计

## 目标

让浏览器可以通过 `https://paws.rodeo` 使用 Paws，同时完整保留现有的
`https://47.115.228.20:8443`。第一阶段不改变 App、CLI、daemon 或 Server 的默认地址。

## 已确认约束

- 继续使用当前中国大陆阿里云服务器 `47.115.228.20`。
- 不讨论、不依赖 ICP 备案，也不更换服务器或购买其他域名。
- `paws.rodeo` 的权威 DNS 从 DNSOwl 切换到 Cloudflare；域名注册商和续费关系不变。
- 第一阶段只验证浏览器。App、CLI 和 daemon 继续使用现有 IP 地址。
- 原 IP 入口在整个试用期保持可用，且是首要回滚入口。
- 第一阶段使用标准 Cloudflare Tunnel，不绑定非官方“优选 IP”。

## 当前生产事实

- Paws Web 的生产入口是 `https://47.115.228.20:8443`。
- 该入口由阿里云服务器上的 Caddy 统一承载：Web HTML/静态资源来自 OSS，
  `/v1/*`、`/v2/*`、`/v3/*`、`/v4/*`、`/files/*`、`/health` 和
  `/v1/updates` WebSocket 进入 Paws Server。
- Web 构建目前通过 `EXPO_PUBLIC_HAPPY_SERVER_URL` 固化 IP；App 的默认地址也仍是 IP。
- `paws.rodeo` 当前尚未委派给 Cloudflare，现有 DNS 记录必须在切换 nameserver 前导出保存。
- 2026-09-06 的只读远程核对未能执行：当前机器直连阿里云没有对应私钥，已登记的
  两跳入口 MacBook Air 当时离线。因此执行阶段必须先重新读取真实
  `/etc/caddy/Caddyfile`，不得只依赖仓库测试 fixture。

## 架构

```text
Browser https://paws.rodeo
          |
          v
Cloudflare edge (TLS 443, DNS proxy)
          |
          v  outbound Tunnel
cloudflared on Alibaba ECS
          |
          v  HTTP loopback only
127.0.0.1:8081 (Caddy tunnel listener)
          |
          +--> Paws API + /v1/updates WebSocket
          |
          +--> OSS-backed Web HTML and static redirects

Existing fallback remains independent:
Browser/App/CLI --> https://47.115.228.20:8443 or http://47.115.228.20:3005
```

`cloudflared` 和 Caddy 位于同一台阿里云服务器。Tunnel origin 使用
`http://127.0.0.1:8081`，因此无需给 origin 再配置证书，也不需要
`noTLSVerify`。端口 `8081` 只监听 loopback，不增加新的公网入站端口。

## Web 地址选择

同一份 OSS Web 构建需要同时支持新域名和旧 IP。Web HTML 在应用 bundle 启动前注入一个
严格限定的运行时配置：

- 页面 host 是 `paws.rodeo` 时，`__HAPPY_CONFIG__.serverUrl` 取
  `window.location.origin`，即 `https://paws.rodeo`。
- 页面 host 是 `47.115.228.20` 时，同样取当前 origin，仍为
  `https://47.115.228.20:8443`。
- 其他 host 不注入，继续遵循现有开发、预览和自托管配置。
- 注入只发生在 Web 导出产物，不修改 React Native App、CLI 或 daemon 的默认值，
  因而不应为本试用触发 App OTA。

## Caddy Tunnel 入口

生产 Caddy 增加一个由仓库脚本管理的 `http://:8081` site block，并在其中显式
设置 `bind 127.0.0.1`。Caddy site label 中的 IP 会生成 Host matcher，不能用它代替
网络绑定；Cloudflare Tunnel origin/service 仍为 `http://127.0.0.1:8081`。它必须：

- 只接受 `Host: paws.rodeo`，其他 Host 返回 `421`。
- 从现有 `47.115.228.20:8443` site block 同步 Web、API、分享页和 WebSocket 路由。
- 排除公网 site 中的 `tls`、`bind` 等监听/TLS 指令。
- 在有序 `route` 中先执行错误 Host 的 `421`，再为 `/v1/*`、`/v2/*`、`/v3/*`、
  `/v4/*`、`/files/*`、`/health` 和 `/v1/updates*` 延迟设置 `Cache-Control: no-store`，
  最后通过 `handle` 保留复制路由的正常排序。该响应头是激活 Tunnel 前必须满足的条件，
  只作用于生成的 loopback listener；旧 IP 响应头保持不变。
- 对未托管站点的路径、引号、环境变量/placeholder 或其他非字面量标签保守拒绝，
  避免未托管 Host 路由共享 8081 并绕过生成的 guard。
- 每次 Web 部署都重新生成，从而避免域名入口与 IP 入口长期漂移。
- 在写入前执行 Caddy validate；reload 失败时恢复备份。

## Cloudflare 配置

- Cloudflare zone：`paws.rodeo`，Free plan 足够完成试用。
- Tunnel 名称：`paws-web-pilot`。
- Public hostname：`paws.rodeo`。
- Service：`http://127.0.0.1:8081`。
- Connector：阿里云服务器上的 systemd service，崩溃后自动重启。
- 首选 connector protocol 为 HTTP/2，以 TCP 7844 为主；若实测环境允许且更稳定，
  再对比 `auto`/QUIC。协议选择必须基于日志和稳定性测试，不凭感觉切换。
- 不启用 Cloudflare Access 登录墙，因为它会阻断现有 API、二维码认证和 WebSocket 客户端。
- 不启用 Cache Everything、Rocket Loader 或会重写应用 JavaScript 的优化。
- API、文件、健康检查和 `/v1/updates` 明确绕过 Cloudflare Cache。

## 安全边界

- 阿里云安全组不开放 8081；`ss` 必须显示该端口只绑定 `127.0.0.1`。
- Tunnel token 只进入服务器的 systemd credential/environment，不写入 Git、日志、计划或聊天。
- `cloudflared` 只需要出站连接 Cloudflare；不为 Tunnel 增加任何公网入站规则。
- DNS 切换前保存全部 DNS 记录和旧 nameserver。删除冲突的 apex A 记录前再次确认它们
  只是当前停放记录。

## 上线顺序

1. 先合入 Web 运行时地址和 Caddy loopback listener，验证旧 IP 完全正常。
2. 将 `paws.rodeo` DNS 委派给 Cloudflare并等待 zone active、Universal SSL ready。
3. 安装 `cloudflared`，创建 Tunnel，但先不把新域名作为正式入口宣传。
4. 创建 `paws.rodeo` public hostname，执行无登录和真实登录浏览器验收。
5. 保持 App、CLI、daemon 和旧 IP 不变，收集新旧入口的延迟、断线和错误数据。

## 验收标准

- `https://paws.rodeo/health` 返回 200，且不是来自缓存。
- 激活 public hostname 前，loopback 动态路由必须返回 `Cache-Control: no-store`。
  文件探针 `/files/tunnel-verification` 允许无凭据的 `404 text/plain; charset=utf-8`，
  但仍拒绝重定向、挑战页、HTML/SPA fallback 和缓存响应。
- 首页、深链、哈希资源和公共分享页可加载，不跳转到 IP。
- 新域名下创建会话、发消息、流式/实时回复和重连正常。
- `/v1/updates` WebSocket 能持续保持，至少完成一次网络切换后的恢复测试。
- 上传、下载、公开分享和 GitHub 连接流程均完成一次检查；若 GitHub 回调仍回到旧 IP，
  记录为浏览器试用限制，不阻塞基础 Tunnel 试用，但不得宣称“全部域名化”。
- 旧 IP 入口在相同版本上仍通过 health、首页和真实会话 smoke test。
- 连续观察至少 24 小时，无反复 5xx、异常挑战页或明显高于旧 IP 的断线率。

## 回滚

回滚不需要迁移数据：停止/禁用 Tunnel public hostname，并让用户重新打开旧 IP。Caddy 的
loopback listener 可以暂时保留，因为公网无法访问；若需彻底撤销，则恢复部署前的 Caddy
备份并 reload。Cloudflare nameserver 可以继续保留，不必为了回滚 Tunnel 再切回 DNSOwl。

## 非目标

- 不迁移 App、CLI、daemon 默认地址。
- 不关闭或重定向旧 IP。
- 不做 ICP 备案方案。
- 不做 Cloudflare China Network 或第三方优选 IP。
- 不承诺 Tunnel 一定比 IP 更快；第一阶段只用数据判断可用性和稳定性。
