/**
 * React Navigation 的 ResourceSavingView 在 Web 上仍通过 View prop 传递
 * pointerEvents，会触发 react-native-web 的弃用警告。
 *
 * Web 分支改用 style.pointerEvents；原生分支保持原有属性与裁剪行为不变。
 */
const fs = require('fs');
const path = require('path');

const nodeModulesRoots = [
    path.resolve(__dirname, '..', 'node_modules'),
    path.resolve(__dirname, '..', 'packages/happy-app/node_modules'),
];

const packagePath = '@react-navigation/elements/package.json';
const relativeResourceTarget = '@react-navigation/elements/lib/module/ResourceSavingView.js';
const relativeScreenTarget = '@react-navigation/elements/lib/module/Screen.js';
const deprecatedWebBranch = `      style: [{
        display: visible ? 'flex' : 'none'
      }, styles.container, style],
      pointerEvents: visible ? 'auto' : 'none',`;
const webSafeBranch = `      style: [{
        display: visible ? 'flex' : 'none'
      }, styles.container, style, {
        pointerEvents: visible ? 'auto' : 'none'
      }],`;
const deprecatedScreenImport = `import { StyleSheet, View } from 'react-native';`;
const webSafeScreenImport = `import { Platform, StyleSheet, View } from 'react-native';`;
const deprecatedScreenHeader = `      children: /*#__PURE__*/_jsx(View, {
        ref: headerRef,
        pointerEvents: "box-none",
        onLayout: e => {`;
const webSafeScreenHeader = `      children: /*#__PURE__*/_jsx(View, {
        ref: headerRef,
        ...Platform.OS === 'web' ? {} : {
          pointerEvents: "box-none"
        },
        onLayout: e => {`;
const deprecatedScreenStyle = `        style: [styles.header, headerTransparent ? styles.absolute : null],
        children: header`;
const webSafeScreenStyle = `        style: [styles.header, headerTransparent ? styles.absolute : null, Platform.OS === 'web' ? {
          pointerEvents: "box-none"
        } : null],
        children: header`;

let patched = 0;
let packagesFound = 0;

for (const nodeModulesRoot of nodeModulesRoots) {
    const packageJson = path.join(nodeModulesRoot, packagePath);
    if (!fs.existsSync(packageJson)) continue;
    packagesFound++;

    const resourceTarget = path.join(nodeModulesRoot, relativeResourceTarget);
    if (!fs.existsSync(resourceTarget)) {
        throw new Error(`[patch] @react-navigation/elements 已安装但缺少 ResourceSavingView：${resourceTarget}`);
    }

    const resourceOriginal = fs.readFileSync(resourceTarget, 'utf8');
    let resourceContent = resourceOriginal;

    if (resourceContent.includes(deprecatedWebBranch)) {
        resourceContent = resourceContent.replace(deprecatedWebBranch, webSafeBranch);
    } else if (!resourceContent.includes(webSafeBranch)) {
        throw new Error(`[patch] ResourceSavingView 缺少预期 Web pointerEvents 锚点：${resourceTarget}`);
    }

    if (resourceContent !== resourceOriginal) {
        fs.writeFileSync(resourceTarget, resourceContent, 'utf8');
        patched++;
    }

    const screenTarget = path.join(nodeModulesRoot, relativeScreenTarget);
    if (!fs.existsSync(screenTarget)) {
        throw new Error(`[patch] @react-navigation/elements 已安装但缺少 Screen：${screenTarget}`);
    }

    const screenOriginal = fs.readFileSync(screenTarget, 'utf8');
    let screenContent = screenOriginal;

    if (screenContent.includes(deprecatedScreenImport)) {
        screenContent = screenContent.replace(deprecatedScreenImport, webSafeScreenImport);
    } else if (!screenContent.includes(webSafeScreenImport)) {
        throw new Error(`[patch] Screen 缺少预期 Platform import 锚点：${screenTarget}`);
    }

    if (screenContent.includes(deprecatedScreenHeader)) {
        screenContent = screenContent.replace(deprecatedScreenHeader, webSafeScreenHeader);
    } else if (!screenContent.includes(webSafeScreenHeader)) {
        throw new Error(`[patch] Screen 缺少预期 header pointerEvents 锚点：${screenTarget}`);
    }

    if (screenContent.includes(deprecatedScreenStyle)) {
        screenContent = screenContent.replace(deprecatedScreenStyle, webSafeScreenStyle);
    } else if (!screenContent.includes(webSafeScreenStyle)) {
        throw new Error(`[patch] Screen 缺少预期 header style 锚点：${screenTarget}`);
    }

    if (screenContent !== screenOriginal) {
        fs.writeFileSync(screenTarget, screenContent, 'utf8');
        patched++;
    }
}

if (packagesFound === 0) {
    throw new Error('[patch] 未找到 @react-navigation/elements，无法应用 Web pointerEvents 修补');
} else if (patched > 0) {
    console.log(`[patch] 修复 React Navigation Web pointerEvents（${patched} 个文件）`);
}
