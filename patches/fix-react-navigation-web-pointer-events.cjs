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
const relativeTarget = '@react-navigation/elements/lib/module/ResourceSavingView.js';
const deprecatedWebBranch = `      style: [{
        display: visible ? 'flex' : 'none'
      }, styles.container, style],
      pointerEvents: visible ? 'auto' : 'none',`;
const webSafeBranch = `      style: [{
        display: visible ? 'flex' : 'none'
      }, styles.container, style, {
        pointerEvents: visible ? 'auto' : 'none'
      }],`;

let patched = 0;
let packagesFound = 0;

for (const nodeModulesRoot of nodeModulesRoots) {
    const packageJson = path.join(nodeModulesRoot, packagePath);
    if (!fs.existsSync(packageJson)) continue;
    packagesFound++;

    const target = path.join(nodeModulesRoot, relativeTarget);
    if (!fs.existsSync(target)) {
        throw new Error(`[patch] @react-navigation/elements 已安装但缺少 ResourceSavingView：${target}`);
    }

    const original = fs.readFileSync(target, 'utf8');
    let content = original;

    if (content.includes(deprecatedWebBranch)) {
        content = content.replace(deprecatedWebBranch, webSafeBranch);
    } else if (!content.includes(webSafeBranch)) {
        throw new Error(`[patch] ResourceSavingView 缺少预期 Web pointerEvents 锚点：${target}`);
    }

    if (content !== original) {
        fs.writeFileSync(target, content, 'utf8');
        patched++;
    }
}

if (packagesFound === 0) {
    console.warn('[patch] 未找到 @react-navigation/elements，跳过 Web pointerEvents 修补');
} else if (patched > 0) {
    console.log(`[patch] 修复 React Navigation Web pointerEvents（${patched} 个文件）`);
}
