const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Make the Android app trust the self-hosted Happy server's self-signed TLS cert.
 *
 * Why: 自部署 Happy 服务器（Caddy）对着公网 IP 没有域名，只能签自签证书
 * （CN/SAN = 47.115.228.20）。Android 默认只信任系统 CA，会拒绝自签证书，
 * 导致「连接服务器失败」。这跟 cleartext 无关——服务器本身是 HTTPS。
 *
 * 做法：把服务器证书作为额外信任锚写进 network_security_config（base-config）。
 * 该证书是叶子证书（无 CA:TRUE），只能验证它自己 SAN 内的主机（这个 IP），
 * **不能为其它域名签发/MITM**，所以不削弱对其它网站的安全。系统 CA 仍照常生效。
 *
 * 局限：若 Caddy 重新生成了不同的自签证书（如清空数据目录），需更新此 pem 并重打包。
 */

const CERT_FILE = path.join(__dirname, 'certs', 'selfhosted_server.pem');
const RAW_NAME = 'selfhosted_server.pem'; // res/raw/，引用名 @raw/selfhosted_server

function withNetworkSecurityManifest(config) {
    return withAndroidManifest(config, (cfg) => {
        const app = cfg.modResults.manifest.application?.[0];
        if (app) {
            app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
        }
        return cfg;
    });
}

function withCertAndXml(config) {
    return withDangerousMod(config, [
        'android',
        (cfg) => {
            const resDir = path.join(
                cfg.modRequest.platformProjectRoot,
                'app', 'src', 'main', 'res'
            );
            const rawDir = path.join(resDir, 'raw');
            const xmlDir = path.join(resDir, 'xml');
            fs.mkdirSync(rawDir, { recursive: true });
            fs.mkdirSync(xmlDir, { recursive: true });

            // 复制证书到 res/raw/
            fs.copyFileSync(CERT_FILE, path.join(rawDir, RAW_NAME));

            // 写 network_security_config.xml
            const xml = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config>
        <trust-anchors>
            <certificates src="system"/>
            <certificates src="@raw/selfhosted_server"/>
        </trust-anchors>
    </base-config>
</network-security-config>
`;
            fs.writeFileSync(
                path.join(xmlDir, 'network_security_config.xml'),
                xml,
                'utf8'
            );
            return cfg;
        },
    ]);
}

module.exports = function withSelfHostedServerTrust(config) {
    config = withNetworkSecurityManifest(config);
    config = withCertAndXml(config);
    return config;
};
