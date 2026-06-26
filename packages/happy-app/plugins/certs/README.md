# 自签证书目录

本目录存放**自部署 Happy 服务器的 TLS 证书**，供 [`../withSelfHostedServerTrust.js`](../withSelfHostedServerTrust.js) 插件在 Android 构建（`prebuild`）时写入信任锚（`network_security_config`）。

## 为什么需要它

自部署服务器（Caddy）对着公网 IP 没有域名，只能签**自签证书**。Android 默认只信任系统 CA、会拒绝自签证书，导致 App「连接服务器失败」。插件把此证书加入信任锚解决该问题（原理详见插件文件头部注释）。

> 该证书是**叶子证书（公钥）、非私钥**，只能验证它自己 SAN 内的主机，不能为其它域名 MITM，不削弱对其它网站的安全。

## 需要放置的文件

| 文件名 | 说明 |
|--------|------|
| `selfhosted_server.pem` | 服务器的叶子证书，内容以 `-----BEGIN CERTIFICATE-----` 开头 |

> ⚠️ **该 pem 被 `.gitignore`（`*.pem`）忽略、不入库**——避免把服务器地址公开到仓库。
> 因此**每台需要构建 Android 包的机器，都要手动把证书放到这里**，否则 `pnpm prebuild` 会因找不到证书而失败。

## 如何获取证书

从运行中的自部署服务器拉取证书（替换为你的 `HOST:PORT`）：

```bash
openssl s_client -connect <HOST>:<PORT> -servername <HOST> </dev/null 2>/dev/null \
  | openssl x509 > selfhosted_server.pem
```

放好后路径应为：

```
packages/happy-app/plugins/certs/selfhosted_server.pem
```

## 局限

若服务器重新生成了不同的自签证书（如清空 Caddy 数据目录），需更新此 pem 并重新打包 APK。
