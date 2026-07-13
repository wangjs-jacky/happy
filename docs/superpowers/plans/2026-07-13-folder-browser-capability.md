# 能力中心「文件夹浏览」模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Happy App 会话右侧「能力中心」把原 Artifacts 那格换成「文件夹」卡,点开可逐层浏览会话工作目录(乃至整个 HOME)下的文件结构,点文件复用现成查看器。

**Architecture:** 两层改动。CLI 侧把 `readFile` / `listDirectory` / `getDirectoryTree` 三个**只读** RPC 的路径边界从「会话工作目录」放宽到「机器 HOME」(写入/命令执行不动)。App 侧新增一个 Finder 式逐层目录浏览详情视图,挂到能力中心网格上(占用 artifacts 格),点文件跳现有 `/session/[id]/file` 查看器。

**Tech Stack:** TypeScript、React Native + Expo(happy-app)、Node.js(happy-cli)、Vitest、react-native-unistyles、expo-router、Socket.io RPC。

## Global Constraints

- **语言**:代码注释用中文;用户可见字符串一律走 `t(...)`,禁止硬编码(见 `packages/happy-app/CLAUDE.md`)。
- **缩进**:happy-app 用 **4 空格**。
- **路径别名**:`@/*` → `packages/happy-app/sources/*`。
- **禁止公司属性内容**:代码/注释/文档中不得出现任何公司名、内部框架名、内部路径。
- **只读**:本功能全程只读,**不得**放宽 `writeFile` / `bash` / `ripgrep` 的 cwd 边界。
- **i18n 覆盖**:新增 key 必须加到英文源 `_default.ts` **和** `translations/` 下全部语言文件(`en.ts, ru, pl, es, it, pt, ca, zh-Hans, zh-Hant, ja`),用 i18n-translator agent 保证结构一致;缺一个语言就 typecheck 失败。
- **组件规范**:页面/组件用 `React.memo` 包裹;styles 放文件末尾,用 `StyleSheet.create` from `react-native-unistyles`;expo-router 用 `useRouter`。
- **分支**:在 sibling worktree `../happy--folder-browser`(分支 `folder-browser`)开发,完成提 PR 到 `main`。
- **提交信息尾注**:每个 commit 追加仓库约定的 `Generated with [Claude Code]... via [Happy]... Co-Authored-By:` 尾注(见 `happy/CLAUDE.md` 第七节)。

---

### Task 1: CLI — home-bounded 只读路径校验 `validateReadPath`

**Files:**
- Modify: `packages/happy-cli/src/modules/common/pathSecurity.ts`
- Test: `packages/happy-cli/src/modules/common/pathSecurity.test.ts`(已存在,追加用例)

**Interfaces:**
- Produces: `validateReadPath(targetPath: string, workingDirectory: string, containmentRoot: string): PathValidationResult`——相对路径仍相对 `workingDirectory` 解析,但「允许访问范围」放宽到 `containmentRoot`。

- [ ] **Step 1: 追加失败测试**

在 `pathSecurity.test.ts` 末尾追加(文件顶部若无这些 import 则补上 `import { validateReadPath } from './pathSecurity';`、`import { homedir } from 'os';`、`import { join } from 'path';`):

```ts
describe('validateReadPath', () => {
    const home = homedir();
    const cwd = join(home, 'projects', 'demo');

    it('allows an absolute path anywhere inside home', () => {
        expect(validateReadPath(join(home, 'other', 'file.ts'), cwd, home).valid).toBe(true);
    });

    it('allows the containment root itself', () => {
        expect(validateReadPath(home, cwd, home).valid).toBe(true);
    });

    it('resolves relative paths against the working directory', () => {
        const r = validateReadPath('src/index.ts', cwd, home);
        expect(r.valid).toBe(true);
        expect(r.resolvedPath).toBe(join(cwd, 'src/index.ts'));
    });

    it('denies an absolute path outside home', () => {
        expect(validateReadPath('/etc/passwd', cwd, home).valid).toBe(false);
    });

    it('denies traversal that escapes home', () => {
        expect(validateReadPath(join(home, '..', 'someone-else'), cwd, home).valid).toBe(false);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-cli && npx vitest run --project unit src/modules/common/pathSecurity.test.ts`
Expected: FAIL —— `validateReadPath is not a function` / 导出不存在。

- [ ] **Step 3: 实现 `validateReadPath`**

在 `pathSecurity.ts`(已 `import { resolve, sep } from 'path';`)末尾追加:

```ts
/**
 * 只读访问校验:相对路径仍相对 workingDirectory 解析(保持既有调用行为),
 * 但「允许访问的根」放宽到 containmentRoot(本项目传机器 HOME)。
 * 用于 readFile / listDirectory / getDirectoryTree,让手机端能浏览 HOME 下
 * 任意文件;写入与命令执行仍走 validatePath(锁在工作目录)。
 */
export function validateReadPath(
    targetPath: string,
    workingDirectory: string,
    containmentRoot: string,
): PathValidationResult {
    const resolvedTarget = resolve(workingDirectory, targetPath);
    const root = resolve(containmentRoot);

    if (resolvedTarget !== root && !resolvedTarget.startsWith(root + sep)) {
        return {
            valid: false,
            resolvedPath: resolvedTarget,
            error: `Access denied: Path '${targetPath}' is outside the allowed root`,
        };
    }

    return { valid: true, resolvedPath: resolvedTarget };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/happy-cli && npx vitest run --project unit src/modules/common/pathSecurity.test.ts`
Expected: PASS(新增 5 条全绿)。

- [ ] **Step 5: 提交**

```bash
git add packages/happy-cli/src/modules/common/pathSecurity.ts packages/happy-cli/src/modules/common/pathSecurity.test.ts
git commit -m "feat(cli): add home-bounded validateReadPath for read-only RPCs

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

### Task 2: CLI — 三个只读 handler 换用 `validateReadPath`

**Files:**
- Modify: `packages/happy-cli/src/modules/common/registerCommonHandlers.ts`

**Interfaces:**
- Consumes: `validateReadPath`(Task 1)、`homedir`(已 `import { homedir } from 'os'`)。
- Produces: `readFile` / `listDirectory` / `getDirectoryTree` 三个 RPC 的访问边界变为机器 HOME;`writeFile` / `bash` / ripgrep 保持不变。

- [ ] **Step 1: 更新 import**

把 `import { validatePath } from './pathSecurity';` 改为:

```ts
import { validatePath, validateReadPath } from './pathSecurity';
```

- [ ] **Step 2: `readFile` handler 换边界**

在 `readFile` handler 内,把:

```ts
        // Validate path is within working directory
        const validation = validatePath(data.path, workingDirectory);
```

改为:

```ts
        // Read is allowed anywhere under the machine HOME (see validateReadPath).
        const validation = validateReadPath(data.path, workingDirectory, homedir());
```

- [ ] **Step 3: `listDirectory` handler 换边界**

在 `listDirectory` handler 内,把 `const validation = validatePath(data.path, workingDirectory);` 改为:

```ts
        const validation = validateReadPath(data.path, workingDirectory, homedir());
```

- [ ] **Step 4: `getDirectoryTree` handler 换边界**

在 `getDirectoryTree` handler 内,把 `const validation = validatePath(data.path, workingDirectory);` 改为:

```ts
        const validation = validateReadPath(data.path, workingDirectory, homedir());
```

> ⚠️ 不要改 `writeFile`(写)、`bash`、ripgrep/difftastic 的 `validatePath(data.cwd/path, workingDirectory)` —— 它们必须保持锁在工作目录。

- [ ] **Step 5: 构建校验(含类型检查)**

Run: `cd packages/happy-cli && pnpm run build`
Expected: 通过(`tsc --noEmit && pkgroll` 无错,产出 `dist/`)。

- [ ] **Step 6: 提交**

```bash
git add packages/happy-cli/src/modules/common/registerCommonHandlers.ts
git commit -m "feat(cli): widen read-only RPC boundary to HOME for folder browser

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

### Task 3: App — 目录导航纯函数 `folderBrowserNav`

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/folderBrowserNav.ts`
- Test: `packages/happy-app/sources/components/rightPanel/folderBrowserNav.test.ts`

**Interfaces:**
- Produces:
  - `getParentPath(path: string): string`
  - `joinChild(dir: string, name: string): string`
  - `canGoUp(currentPath: string, homeDir: string): boolean`
  - `type BackTarget = { kind: 'up'; path: string } | { kind: 'exit' }`
  - `resolveBack(currentPath: string, rootPath: string, homeDir: string): BackTarget`

- [ ] **Step 1: 写失败测试**

创建 `folderBrowserNav.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getParentPath, joinChild, canGoUp, resolveBack } from './folderBrowserNav';

describe('getParentPath', () => {
    it('drops the last segment', () => {
        expect(getParentPath('/Users/j/projects/demo')).toBe('/Users/j/projects');
    });
    it('handles a trailing slash', () => {
        expect(getParentPath('/Users/j/demo/')).toBe('/Users/j');
    });
    it('caps at filesystem root', () => {
        expect(getParentPath('/Users')).toBe('/');
        expect(getParentPath('/')).toBe('/');
    });
});

describe('joinChild', () => {
    it('joins a child name', () => {
        expect(joinChild('/Users/j', 'demo')).toBe('/Users/j/demo');
    });
    it('normalizes a trailing slash', () => {
        expect(joinChild('/Users/j/', 'demo')).toBe('/Users/j/demo');
    });
});

describe('canGoUp', () => {
    it('is false at home', () => {
        expect(canGoUp('/Users/j', '/Users/j')).toBe(false);
    });
    it('is true below home', () => {
        expect(canGoUp('/Users/j/projects', '/Users/j')).toBe(true);
    });
});

describe('resolveBack', () => {
    const home = '/Users/j';
    const root = '/Users/j/projects/demo';
    it('exits at the browser root', () => {
        expect(resolveBack(root, root, home)).toEqual({ kind: 'exit' });
    });
    it('goes up one level below root', () => {
        expect(resolveBack('/Users/j/projects/demo/src', root, home)).toEqual({ kind: 'up', path: root });
    });
    it('goes up when navigated above root', () => {
        expect(resolveBack('/Users/j/projects', root, home)).toEqual({ kind: 'up', path: home });
    });
    it('exits at home even when home is not the root', () => {
        expect(resolveBack(home, root, home)).toEqual({ kind: 'exit' });
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/happy-app && npx vitest run sources/components/rightPanel/folderBrowserNav.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现纯函数**

创建 `folderBrowserNav.ts`:

```ts
/**
 * 文件夹浏览器的纯路径导航函数。仅处理 POSIX 风格绝对路径(远端开发机是
 * macOS/Linux)。刻意不依赖 React / RPC,好让导航规则可独立单测。
 */

/** 取上一级目录;封顶到文件系统根 `/`。 */
export function getParentPath(path: string): string {
    if (path === '/' || path === '') return '/';
    const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
    const idx = trimmed.lastIndexOf('/');
    return idx <= 0 ? '/' : trimmed.slice(0, idx);
}

/** 拼接子项路径(处理父目录尾部斜杠)。 */
export function joinChild(dir: string, name: string): string {
    const base = dir.endsWith('/') ? dir.slice(0, -1) : dir;
    return `${base}/${name}`;
}

/** 是否还能向上(不越过 HOME)。到达 HOME 即不可再上。 */
export function canGoUp(currentPath: string, homeDir: string): boolean {
    return currentPath !== homeDir;
}

export type BackTarget = { kind: 'up'; path: string } | { kind: 'exit' };

/**
 * 解析「返回」手势去向:逐层上退到浏览器根目录,到根则退出回能力中心;
 * 永不越过 HOME。
 */
export function resolveBack(currentPath: string, rootPath: string, homeDir: string): BackTarget {
    if (currentPath === rootPath || !canGoUp(currentPath, homeDir)) {
        return { kind: 'exit' };
    }
    return { kind: 'up', path: getParentPath(currentPath) };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/happy-app && npx vitest run sources/components/rightPanel/folderBrowserNav.test.ts`
Expected: PASS(全绿)。

- [ ] **Step 5: 提交**

```bash
git add packages/happy-app/sources/components/rightPanel/folderBrowserNav.ts packages/happy-app/sources/components/rightPanel/folderBrowserNav.test.ts
git commit -m "feat(app): add pure path-nav helpers for folder browser

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

### Task 4: App — i18n 新增 key(全部语言)

**Files:**
- Modify: `packages/happy-app/sources/text/_default.ts`(英文源 + 类型)
- Modify: `packages/happy-app/sources/text/translations/{en,ru,pl,es,it,pt,ca,zh-Hans,zh-Hant,ja}.ts`

**Interfaces:**
- Produces 新 i18n key(供 Task 6 / Task 7 引用):
  - `rightPanelCapabilityHub.blocks.folderBrowser`
  - `rightPanelCapabilityHub.empty.folderBrowser`
  - `rightPanelCapabilityHub.folderBrowser.upOneLevel`
  - `rightPanelCapabilityHub.folderBrowser.loadError`
  - `rightPanelCapabilityHub.folderBrowser.retry`

- [ ] **Step 1: 英文源加 key(`_default.ts`)**

在 `_default.ts` 的 `rightPanelCapabilityHub` 对象内:
- `blocks` 里追加一行:`folderBrowser: 'Folder',`
- `empty` 里追加一行:`folderBrowser: 'This folder is empty',`
- 在 `blocks` / `empty` / `meta` 同级追加一个新子对象:

```ts
        folderBrowser: {
            upOneLevel: 'Up one level',
            loadError: 'Could not load this folder',
            retry: 'Retry',
        },
```

- [ ] **Step 2: 用 i18n-translator agent 同步全部语言**

调用 **i18n-translator** agent,指令:把上面 5 个新 key 加到 `packages/happy-app/sources/text/translations/` 下**每个**语言文件的 `rightPanelCapabilityHub` 段(`en, ru, pl, es, it, pt, ca, zh-Hans, zh-Hant, ja`),保持与 `_default.ts` 完全相同的结构。英文源字符串如上;中文(zh-Hans)参考:

```ts
        // blocks 内
        folderBrowser: '文件夹',
        // empty 内
        folderBrowser: '这个文件夹是空的',
        // 新子对象
        folderBrowser: {
            upOneLevel: '上一层',
            loadError: '无法加载此文件夹',
            retry: '重试',
        },
```

> 说明:`blocks.artifacts` / `empty.artifacts` 等旧 key **保留不删**(无害,避免牵动其它语言文件)。

- [ ] **Step 3: 类型检查确认结构一致**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过(任一语言缺 key 都会因 `TranslationStructure` 强类型报错)。

- [ ] **Step 4: 提交**

```bash
git add packages/happy-app/sources/text/_default.ts packages/happy-app/sources/text/translations
git commit -m "i18n(app): add folder browser capability strings

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

### Task 5: App — 卡片条目数 hook `useFolderRootCount`

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/useFolderRootCount.ts`

**Interfaces:**
- Consumes: `sessionListDirectory`(`@/sync/ops`,已存在)。
- Produces: `useFolderRootCount(sessionId: string | undefined, rootPath: string | null): number | null`——懒加载会话工作目录顶层条目数,带模块级内存缓存;未知/无会话返回 `null`。

- [ ] **Step 1: 实现 hook**

创建 `useFolderRootCount.ts`:

```ts
import * as React from 'react';
import { sessionListDirectory } from '@/sync/ops';

// 模块级缓存:同一 (session, path) 只请求一次 listDirectory,避免每次滑出
// 右侧面板都重新拉。key = `${sessionId}::${rootPath}`。
const rootCountCache = new Map<string, number>();

/**
 * 懒加载会话工作目录下的顶层条目数,用于「文件夹」能力卡的角标数字。
 * 加载完成前(或无会话/无路径)返回 null。
 */
export function useFolderRootCount(sessionId: string | undefined, rootPath: string | null): number | null {
    const key = sessionId && rootPath ? `${sessionId}::${rootPath}` : null;
    const [count, setCount] = React.useState<number | null>(() => (key ? rootCountCache.get(key) ?? null : null));

    React.useEffect(() => {
        if (!sessionId || !rootPath || !key) return;
        const cached = rootCountCache.get(key);
        if (cached !== undefined) {
            setCount(cached);
            return;
        }
        let cancelled = false;
        (async () => {
            const res = await sessionListDirectory(sessionId, rootPath);
            if (cancelled) return;
            if (res.success && Array.isArray(res.entries)) {
                rootCountCache.set(key, res.entries.length);
                setCount(res.entries.length);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionId, rootPath, key]);

    return count;
}
```

- [ ] **Step 2: 类型检查**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add packages/happy-app/sources/components/rightPanel/useFolderRootCount.ts
git commit -m "feat(app): add useFolderRootCount hook for folder card badge

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

### Task 6: App — 目录浏览详情视图 `SessionFolderBrowserView`

**Files:**
- Create: `packages/happy-app/sources/components/rightPanel/SessionFolderBrowserView.tsx`

**Interfaces:**
- Consumes: `folderBrowserNav`(Task 3)、`sessionListDirectory`(`@/sync/ops`)、`formatPathRelativeToHome`(`@/utils/sessionUtils`)、`FileIcon`(`@/components/FileIcon`)、`useRightSwipePanel`(`../RightSwipePanelHost`,返回 `{ closePanel, open, registerBackHandler }`)、`hapticsLight`(`../haptics`)、Task 4 的 i18n key、现有查看器路由 `/session/[id]/file?path=<base64>`。
- Produces: `SessionFolderBrowserView` 组件,props `{ sessionId: string; rootPath: string; homeDir: string; onExit: () => void }`。

- [ ] **Step 1: 实现组件**

创建 `SessionFolderBrowserView.tsx`:

```tsx
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { FileIcon } from '@/components/FileIcon';
import { sessionListDirectory } from '@/sync/ops';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { t } from '@/text';
import { hapticsLight } from '../haptics';
import { useRightSwipePanel } from '../RightSwipePanelHost';
import { canGoUp, getParentPath, joinChild, resolveBack } from './folderBrowserNav';

type Entry = { name: string; type: 'file' | 'directory' | 'other'; size?: number; modified?: number };

// 逐层懒加载的目录浏览器:根 = 会话工作目录,可上爬到 HOME;点文件跳现有查看器。
export const SessionFolderBrowserView = React.memo(function SessionFolderBrowserView(props: {
    sessionId: string;
    rootPath: string;
    homeDir: string;
    onExit: () => void;
}) {
    const { sessionId, rootPath, homeDir, onExit } = props;
    const { theme } = useUnistyles();
    const router = useRouter();
    const panel = useRightSwipePanel();
    const [currentPath, setCurrentPath] = React.useState(rootPath);
    const [entries, setEntries] = React.useState<Entry[]>([]);
    const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
    const [reloadTick, setReloadTick] = React.useState(0);

    // 路径变化(或手动重试)时拉取当前目录列表。
    React.useEffect(() => {
        let cancelled = false;
        setStatus('loading');
        (async () => {
            const res = await sessionListDirectory(sessionId, currentPath);
            if (cancelled) return;
            if (res.success && Array.isArray(res.entries)) {
                setEntries(res.entries as Entry[]);
                setStatus('ready');
            } else {
                setStatus('error');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [sessionId, currentPath, reloadTick]);

    const handleBack = React.useCallback(() => {
        const target = resolveBack(currentPath, rootPath, homeDir);
        if (target.kind === 'up') {
            setCurrentPath(target.path);
        } else {
            onExit();
        }
        return true;
    }, [currentPath, rootPath, homeDir, onExit]);

    // 把面板返回手势也接到同一套逻辑;路径变化时重挂,保证读到最新位置。
    React.useEffect(() => {
        return panel?.registerBackHandler(handleBack);
    }, [panel, handleBack]);

    const goUp = React.useCallback(() => {
        if (!canGoUp(currentPath, homeDir)) return;
        hapticsLight();
        setCurrentPath(getParentPath(currentPath));
    }, [currentPath, homeDir]);

    const openEntry = React.useCallback((entry: Entry) => {
        hapticsLight();
        const childPath = joinChild(currentPath, entry.name);
        if (entry.type === 'directory') {
            setCurrentPath(childPath);
        } else {
            router.push(`/session/${sessionId}/file?path=${btoa(childPath)}` as any);
            panel?.closePanel();
        }
    }, [currentPath, router, sessionId, panel]);

    const upEnabled = canGoUp(currentPath, homeDir);

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Pressable hitSlop={8} onPress={handleBack} style={styles.headerButton}>
                    <Ionicons color={theme.colors.text} name="chevron-back" size={20} />
                </Pressable>
                <Text numberOfLines={1} style={[styles.headerPath, { color: theme.colors.text }]}>
                    {formatPathRelativeToHome(currentPath, homeDir)}
                </Text>
                <Pressable
                    accessibilityLabel={t('rightPanelCapabilityHub.folderBrowser.upOneLevel')}
                    disabled={!upEnabled}
                    hitSlop={8}
                    onPress={goUp}
                    style={styles.headerButton}
                >
                    <Ionicons
                        color={upEnabled ? theme.colors.text : theme.colors.textSecondary}
                        name="arrow-up"
                        size={20}
                    />
                </Pressable>
            </View>

            {status === 'loading' ? (
                <View style={styles.center}>
                    <ActivityIndicator color={theme.colors.textSecondary} size="small" />
                </View>
            ) : status === 'error' ? (
                <View style={styles.center}>
                    <Text style={[styles.muted, { color: theme.colors.textSecondary }]}>
                        {t('rightPanelCapabilityHub.folderBrowser.loadError')}
                    </Text>
                    <Pressable onPress={() => setReloadTick((n) => n + 1)} style={styles.retryButton}>
                        <Text style={[styles.retryText, { color: theme.colors.textLink }]}>
                            {t('rightPanelCapabilityHub.folderBrowser.retry')}
                        </Text>
                    </Pressable>
                </View>
            ) : entries.length === 0 ? (
                <View style={styles.center}>
                    <Text style={[styles.muted, { color: theme.colors.textSecondary }]}>
                        {t('rightPanelCapabilityHub.empty.folderBrowser')}
                    </Text>
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                    {entries.map((entry) => (
                        <Pressable
                            key={entry.name}
                            onPress={() => openEntry(entry)}
                            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
                        >
                            {entry.type === 'directory' ? (
                                <Ionicons color={theme.colors.textLink} name="folder" size={18} style={styles.rowIcon} />
                            ) : (
                                <View style={styles.rowIcon}>
                                    <FileIcon fileName={entry.name} size={18} />
                                </View>
                            )}
                            <Text numberOfLines={1} style={[styles.rowName, { color: theme.colors.text }]}>
                                {entry.name}
                            </Text>
                            {entry.type === 'directory' && (
                                <Ionicons color={theme.colors.textSecondary} name="chevron-forward" size={16} />
                            )}
                        </Pressable>
                    ))}
                </ScrollView>
            )}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
    },
    header: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
        paddingBottom: 10,
        paddingHorizontal: 4,
        paddingTop: 6,
    },
    headerButton: {
        alignItems: 'center',
        height: 32,
        justifyContent: 'center',
        width: 32,
    },
    headerPath: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
    },
    center: {
        alignItems: 'center',
        flex: 1,
        gap: 10,
        justifyContent: 'center',
        paddingVertical: 40,
    },
    muted: {
        fontSize: 13,
    },
    retryButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    retryText: {
        fontSize: 14,
        fontWeight: '600',
    },
    listContent: {
        paddingBottom: 24,
    },
    row: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 4,
        paddingVertical: 10,
    },
    rowIcon: {
        alignItems: 'center',
        height: 20,
        justifyContent: 'center',
        width: 20,
    },
    rowName: {
        flex: 1,
        fontSize: 14,
    },
}));
```

- [ ] **Step 2: 类型检查**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过。若报 `folderBrowser` i18n key 不存在 → 回头确认 Task 4 已完成。

- [ ] **Step 3: 提交**

```bash
git add packages/happy-app/sources/components/rightPanel/SessionFolderBrowserView.tsx
git commit -m "feat(app): add SessionFolderBrowserView drill-down folder browser

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

### Task 7: App — 挂卡到能力中心(占用 artifacts 格)

**Files:**
- Modify: `packages/happy-app/sources/components/rightPanel/SessionCapabilityHub.tsx`

**Interfaces:**
- Consumes: `SessionFolderBrowserView`(Task 6)、`useFolderRootCount`(Task 5)、`formatPathRelativeToHome`(`@/utils/sessionUtils`)、Task 4 的 i18n key。
- Produces: 能力中心网格第 5 格 = 「文件夹」卡;`selectedKey === 'folderBrowser'` 时渲染浏览器详情视图。

- [ ] **Step 1: 增加 import**

在文件顶部 import 区加:

```ts
import { formatPathRelativeToHome } from '@/utils/sessionUtils';
import { SessionFolderBrowserView } from './SessionFolderBrowserView';
import { useFolderRootCount } from './useFolderRootCount';
```

- [ ] **Step 2: 扩展面板 key 类型 + 网格顺序**

把:

```ts
type CapabilityPanelKey = CapabilityKey | 'sessionActions';

const BLOCK_ORDER: CapabilityPanelKey[] = ['sessionActions', 'skills', 'quickPrompts', 'images', 'artifacts', 'files'];
```

改为:

```ts
type CapabilityPanelKey = CapabilityKey | 'sessionActions' | 'folderBrowser';

const BLOCK_ORDER: CapabilityPanelKey[] = ['sessionActions', 'skills', 'quickPrompts', 'images', 'folderBrowser', 'files'];
```

- [ ] **Step 3: 在 Loaded 组件里取工作目录 + 条目数**

在 `SessionCapabilityHubLoaded` 里,`const model = useSessionCapabilityHub(props.sessionId);` 之后加:

```ts
    const rootPath = props.session.metadata?.path ?? null;
    const homeDir = props.session.metadata?.homeDir ?? null;
    const folderCount = useFolderRootCount(props.sessionId, rootPath);
```

- [ ] **Step 4: 加 `folderBrowser` 详情分支**

在 `if (selectedKey) { ... }` 块内,`if (selectedKey === 'sessionActions') { ... }` 分支之后、通用 `return <CapabilityHubDetailView ... />` 之前,插入:

```tsx
        if (selectedKey === 'folderBrowser') {
            if (!rootPath || !homeDir) {
                return null;
            }
            return (
                <SessionFolderBrowserView
                    homeDir={homeDir}
                    onExit={() => setSelectedKey(null)}
                    rootPath={rootPath}
                    sessionId={sessionId}
                />
            );
        }
```

> 这样在通用 return 处 `selectedKey` 已被 narrow 成 `CapabilityKey`,`model.details[selectedKey]` 才能通过类型检查。

- [ ] **Step 5: 网格里渲染「文件夹」卡**

在 `<View style={styles.grid}>` 的 `BLOCK_ORDER.map((key) => { ... })` 内,`if (key === 'sessionActions') { ... }` 之后、`const block = model.blocks.find(...)` 之前,插入:

```tsx
                    if (key === 'folderBrowser') {
                        return (
                            <CapabilityBlockCard
                                count={folderCount ?? 0}
                                disabled={!rootPath}
                                icon={<Ionicons color={rootPath ? theme.colors.text : theme.colors.textSecondary} name="folder-outline" size={16} />}
                                key={key}
                                onPress={rootPath ? () => setSelectedKey(key) : undefined}
                                preview={rootPath ? formatPathRelativeToHome(rootPath, homeDir ?? undefined) : null}
                                title={t('rightPanelCapabilityHub.blocks.folderBrowser')}
                            />
                        );
                    }
```

- [ ] **Step 6: 占位态图标兜底(`renderPanelIcon`)**

`CapabilityHubPlaceholder` 会遍历含 `folderBrowser` 的 `BLOCK_ORDER` 并对非 `sessionActions` 的 key 调 `renderBlockIcon(key, ...)`(其类型只接受 `CapabilityKey`)。新增一个统一图标函数,放在 `renderBlockIcon` 函数下方:

```tsx
function renderPanelIcon(key: CapabilityPanelKey, color: string) {
    if (key === 'sessionActions') {
        return <Ionicons color={color} name="ellipsis-horizontal-circle-outline" size={17} />;
    }
    if (key === 'folderBrowser') {
        return <Ionicons color={color} name="folder-outline" size={16} />;
    }
    return renderBlockIcon(key, color);
}
```

然后把 `CapabilityHubPlaceholder` 的 grid map 改为:

```tsx
                {BLOCK_ORDER.map((key) => (
                    <CapabilityBlockCard
                        count={0}
                        disabled={true}
                        icon={renderPanelIcon(key, theme.colors.textSecondary)}
                        key={key}
                        preview={null}
                        title={t(`rightPanelCapabilityHub.blocks.${key}` as const)}
                    />
                ))}
```

- [ ] **Step 7: 类型检查**

Run: `cd packages/happy-app && pnpm typecheck`
Expected: 通过。常见报错:`model.details['folderBrowser']` 不存在 → 确认 Step 4 的分支在通用 return 之前;`blocks.folderBrowser` 缺失 → 确认 Task 4。

- [ ] **Step 8: 提交**

```bash
git add packages/happy-app/sources/components/rightPanel/SessionCapabilityHub.tsx
git commit -m "feat(app): swap artifacts card for folder browser in capability hub

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

### Task 8: 集成验收 + preview OTA

**Files:**
- 无新增改动(验证 + 发布)

- [ ] **Step 1: 全量类型检查 + 单测**

```bash
cd packages/happy-app && pnpm typecheck && npx vitest run sources/components/rightPanel/folderBrowserNav.test.ts
cd ../happy-cli && npx vitest run --project unit src/modules/common/pathSecurity.test.ts
```
Expected: 均通过。

- [ ] **Step 2: 本机重建 CLI(dev-link 生效)**

```bash
cd packages/happy-cli && pnpm run build
```
Expected: 成功。**新开的会话**才会加载新 CLI(已在跑的会话是旧代码)。

- [ ] **Step 3: 真机手动验收(本机新开一个会话)**

- [ ] 能力中心第 5 格显示「文件夹」卡,大数字 = 项目根条目数,预览行 = `~/…` 形式的工作目录。
- [ ] 点开逐层进入子目录正常;文件夹在前、文件在后。
- [ ] 顶部「上一层」能爬到 HOME;到 HOME 后「上一层」置灰。
- [ ] 点 `.ts` / `.md` 打开查看器,语法高亮正常。
- [ ] 进入 HOME 下**另一个项目**的目录并打开其中文件,能正常显示(验证边界已放宽到 HOME)。
- [ ] 面板返回手势:深层→上退一层;根目录→退回能力中心首页。

- [ ] **Step 4: 发 preview OTA(App 侧改动)**

```bash
cd packages/happy-app && pnpm ota:selfhost:preview
```
Expected: 打印频道/新版本 id/manifest 地址。回复用户时附 `<happy-ota-preview>` 卡片。

> ⚠️ **CLI 改动不随 OTA 走**。给用户的说明里要写明:本机已重建 `dist/`;Mac mini / npm 版 `@wangjs-jacky/paws` 需另行更新 CLI 才能在那些机器上「看项目外」;未更新的机器上,浏览器仍只能停在工作目录内(readFile/listDirectory 会对 HOME 外返回 Access denied,不会崩)。

- [ ] **Step 5: 提 PR 到 main**

```bash
git push -u origin folder-browser
gh pr create --repo wangjs-jacky/happy --base main --head folder-browser \
  --title "feat: folder browser in session capability hub" \
  --body "能力中心新增文件夹浏览(占用 artifacts 格),复用现有文件查看器;CLI 只读 RPC 边界放宽到 HOME。详见 docs/superpowers/specs/2026-07-13-folder-browser-capability-design.md"
```

---

## 附:文件结构总览

| 文件 | 职责 | Task |
|------|------|------|
| `happy-cli/.../pathSecurity.ts` | 新增 `validateReadPath`(home-bounded 只读校验) | 1 |
| `happy-cli/.../pathSecurity.test.ts` | `validateReadPath` 单测 | 1 |
| `happy-cli/.../registerCommonHandlers.ts` | 3 个只读 handler 换用新校验 | 2 |
| `happy-app/.../rightPanel/folderBrowserNav.ts` | 纯路径导航函数 | 3 |
| `happy-app/.../rightPanel/folderBrowserNav.test.ts` | 导航函数单测 | 3 |
| `happy-app/.../text/_default.ts` + `translations/*` | i18n 新 key(全语言) | 4 |
| `happy-app/.../rightPanel/useFolderRootCount.ts` | 卡片条目数懒加载 hook | 5 |
| `happy-app/.../rightPanel/SessionFolderBrowserView.tsx` | 逐层目录浏览详情视图 | 6 |
| `happy-app/.../rightPanel/SessionCapabilityHub.tsx` | 挂卡 + 详情分支 + 占位图标 | 7 |
