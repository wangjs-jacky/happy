# CLAUDE.md — 二开协作约定

> 本仓库是 [slopus/happy](https://github.com/slopus/happy) 的个人二开 fork。
> 本文件规定**分支模型**与 **worktree 开发流程**，所有在本仓库工作的 Claude 会话都必须遵守。

## 一、远端与仓库

| 远端 | 地址 | 用途 |
|------|------|------|
| `origin` | `github.com/wangjs-jacky/happy` | 你的 fork，**二开主场**，所有开发推这里 |
| `upstream` | `github.com/slopus/happy` | 上游原项目，**只读**，仅用于跟进更新 |

## 二、分支模型

```
upstream/main (slopus)         ← 上游基线，只读，永不直接改
        │  fetch / merge
        ▼
   origin/jacky-main           ← 【你的主分支】二开长期集成基线
        ▲
        │  Pull Request（不直接 push 功能 commit）
   feat/* · fix/*              ← 功能/修复分支，从 jacky-main 切出
```

- **`jacky-main` 是本 fork 的主分支**，是二开的集成基线，所有成果最终汇入这里。
- **禁止把功能 commit 直接 push 到 `jacky-main`**，一律通过 PR 合入（`--base jacky-main`），保留评审与记录。
- 功能分支从 `jacky-main` 切出，开发完提 PR 回 `jacky-main`。

> ⚠️ 根目录 `AGENTS.md` 里的 "Sync To Main" 工作流针对的是上游语境的 `origin/main`。
> 在本 fork 二开语境中，「主分支」始终指 **`jacky-main`**，以本文件为准。

## 三、日常开发流程

```bash
# 1. 确保 jacky-main 最新
git switch jacky-main && git pull origin jacky-main

# 2. 切功能分支（推荐用 worktree，见第四节）
git switch -c feat/<topic> jacky-main

# 3. 开发、提交（提交信息见第六节）
git add -p && git commit

# 4. 推送到 fork
git push -u origin feat/<topic>

# 5. 提 PR 到 jacky-main
gh pr create --repo wangjs-jacky/happy --base jacky-main --head feat/<topic>
```

## 四、Worktree 开发流程（隔离开发，推荐）

需要在不打断当前工作区的前提下并行开发时，用 git worktree。约定如下（与全局 `~/.claude/CLAUDE.md` 一致）：

| 项目 | 约定 |
|------|------|
| **位置** | 仓库**同级目录（sibling）**：`../happy--<topic>`。**不要**放在仓库内部或 `.claude/worktrees/` 等工具默认路径 |
| **命名** | 目录 `happy--<topic>`；分支名直接用 `<topic>` slug，**不加 `worktree-` 前缀** |
| **基分支** | 一律从 `jacky-main` 切 |

### 创建

```bash
# 从 jacky-main 切出隔离 worktree + 同名分支
git worktree add ../happy--<topic> -b <topic> jacky-main
```

### 安装依赖（pnpm monorepo）

本仓库是 **pnpm workspace**（`pnpm@10.11.0`，7 个包）。worktree 里直接重新安装即可，pnpm 全局 store 会硬链接复用、很快：

```bash
cd ../happy--<topic>
pnpm install
```

> ❗ **不要**像普通 npm 项目那样 symlink 整个 `node_modules`：pnpm 的 `node_modules/.pnpm` 虚拟 store + 各 workspace 包各自的 `node_modules` 结构复杂，symlink 极易损坏。老老实实 `pnpm install`。

### 开发完成

```bash
# 推送并提 PR
git -C ../happy--<topic> push -u origin <topic>
gh pr create --repo wangjs-jacky/happy --base jacky-main --head <topic>

# 合并后清理 worktree 与分支
git worktree remove ../happy--<topic>
git branch -d <topic>
```

## 五、同步上游更新

定期把上游的新提交并入 `jacky-main`：

```bash
git fetch upstream
git switch jacky-main
git merge upstream/main        # 或 git rebase upstream/main
# 解决冲突后
git push origin jacky-main
```

## 六、构建与本机运行说明

- **构建单个包**：`cd packages/happy-cli && pnpm run build`（`tsc --noEmit && pkgroll`，产物在 `dist/`，已被 `.gitignore` 忽略）。
- **本机为 dev-link 模式**：全局 `happy` 命令通过 `npm link` 指向 `packages/happy-cli`。因此**改源码 → `pnpm run build` 重建 `dist/` 即对新会话生效，无需发布 npm 包**。
  - daemon 给每个新会话 spawn 全新进程读取 `dist/`，**重建后不必重启 daemon**；但**已在运行的会话**仍是旧代码（已加载进内存），需新开会话才用上新代码。
- 只有当你想让**其他机器 / 其他人**用上改动，或想从 dev-link 切回干净的 npm 安装版时，才需要走「发 npm 包」流程。

## 七、提交信息规范

```
<type>(<scope>): <简述>

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
```

- 推送/拉取前若需代理：`git config --global http.proxy http://127.0.0.1:10802`（https 同理），完成后 `--unset`。
