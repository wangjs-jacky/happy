/**
 * expo-notifications 的自动注册模块会在加载入口时订阅 push token 变化。
 * 该订阅在 Web 上没有效果，却会为每个懒加载 bundle 打印警告。
 *
 * Web 端跳过这个无效副作用；iOS 和 Android 保持原有自动注册行为。
 */
const fs = require('fs');
const path = require('path');

const nodeModulesRoots = [
    path.resolve(__dirname, '..', 'node_modules'),
    path.resolve(__dirname, '..', 'packages/happy-app/node_modules'),
];

const relativeTarget = 'expo-notifications/build/DevicePushTokenAutoRegistration.fx.js';
const platformImport = "import { Platform } from 'react-native';";
const registrationCondition = 'if (ServerRegistrationModule.getRegistrationInfoAsync) {';
const webSafeRegistrationCondition =
    "if (Platform.OS !== 'web' && ServerRegistrationModule.getRegistrationInfoAsync) {";
const unavailableBranch =
    "else {\n    console.warn(`[expo-notifications] Error encountered while fetching auto-registration state";
const webSafeUnavailableBranch =
    "else if (Platform.OS !== 'web') {\n    console.warn(`[expo-notifications] Error encountered while fetching auto-registration state";

let patched = 0;
let packagesFound = 0;

for (const nodeModulesRoot of nodeModulesRoots) {
    const packageJson = path.join(nodeModulesRoot, 'expo-notifications/package.json');
    if (!fs.existsSync(packageJson)) continue;
    packagesFound++;

    const target = path.join(nodeModulesRoot, relativeTarget);
    if (!fs.existsSync(target)) {
        throw new Error(`[patch] expo-notifications 已安装但缺少自动注册模块：${target}`);
    }
    let content = fs.readFileSync(target, 'utf8');
    const original = content;

    if (!content.includes(platformImport)) {
        const anchor = "import { UnavailabilityError } from 'expo-modules-core';";
        if (!content.includes(anchor)) {
            throw new Error(`[patch] expo-notifications 缺少预期 import 锚点：${target}`);
        }
        content = content.replace(anchor, `${anchor}\n${platformImport}`);
    }

    if (content.includes(registrationCondition)) {
        content = content.replace(registrationCondition, webSafeRegistrationCondition);
    } else if (!content.includes(webSafeRegistrationCondition)) {
        throw new Error(`[patch] expo-notifications 缺少预期自动注册条件：${target}`);
    }

    if (content.includes(unavailableBranch)) {
        content = content.replace(unavailableBranch, webSafeUnavailableBranch);
    } else if (!content.includes(webSafeUnavailableBranch)) {
        throw new Error(`[patch] expo-notifications 缺少预期不可用分支：${target}`);
    }

    if (content !== original) {
        fs.writeFileSync(target, content, 'utf8');
        patched++;
    }
}

if (packagesFound === 0) {
    console.warn('[patch] 未找到 expo-notifications，跳过 Web token listener 修补');
} else if (patched > 0) {
    console.log(`[patch] 跳过 expo-notifications Web token listener（${patched} 个文件）`);
}
