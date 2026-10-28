# Vibe Kanban × Agnx 子应用接入记录

> appId `vibe-kanban` ｜ 独占端口 **8120** ｜ 上游 BloopAI/vibe-kanban ｜ Apache-2.0

## 一、上游嵌入

- **上游原生平台**：桌面 ✅ ｜ 网页 ✅ ｜ 移动 ❌
  - 桌面 ✅：官方发布 Tauri 桌面包（`npx vibe-kanban --desktop`，`crates/tauri-app`）
  - 网页 ✅：Rust 服务端内嵌 React 前端，`http://127.0.0.1:<port>` 浏览器模式即官方主用法（`crates/server/src/routes/frontend.rs`）
  - 移动 ❌：无移动端构建目标
  - 本子应用按「网页形态」嫁接（服务端 + 内嵌前端），只声明 `platforms.desktop=supported`、`web/mobile=unsupported`——因为 Agnx 宿主 Tab 只在桌面端可用。

- **工作方式**：**原样嵌入（首选）**。不 clone 整个 monorepo、不跑 `pnpm run dev`、不改一行 Rust/TS 业务代码。
  - 用官方预先编译的发布二进制 `vibe-kanban`（来自上游 npm 包的 R2 二进制源 `npm-cdn.vibekanban.com`，版本 tag `v0.1.44-20260424091429`，对应 npm 包 `vibe-kanban@0.1.44`），落在 `.agnx/bin/vibe-kanban`（135MB，macos-x64）。
  - 端口 / 绑定地址 / 数据目录**全部靠环境变量**注入（见第二节），零代码改动。

- **上游改动清单**：**无**。（没有 patch、没有 fork、没有改源码。`HOME` / `XDG_*` / `BACKEND_PORT` / `PORT` / `HOST` / `BROWSER` 都是上游自己读的环境变量或操作系统约定。）

- **挂载**：`guest.auth = "none"`、`preferStrategy = "auto"` → 实际走 **`direct-iframe`**
  - 实测依据：面板内 `<iframe src="http://127.0.0.1:8120">` 可直接从 `[data-testid="workspace-mini-app-vibe-kanban-root"]` 内查到，`document.querySelector("webview[src]")` 为 `null`。
  - 选 `direct-iframe` 而非 `guest-webview` 的理由：上游不发 `X-Frame-Options` / CSP `frame-ancestors`（`curl -sI` 实测只有 `HTTP/1.1 200 OK`），无 cookie 会话、无 token，属于合同 §9.4 表里的「无 cookie 的 Web UI」→ `direct-iframe`（桌面 + 网页）。

- **上游**：`BloopAI/vibe-kanban` @ npm `vibe-kanban@0.1.44`（二进制 tag `v0.1.44-20260424091429`）；许可 **Apache-2.0**（上游仓库 `LICENSE` 为 Apache License 2.0）。
  - 说明：直连 `github.com` 的 `git clone` 在本机超时、GitHub API 命中限流，因此源码审阅用的是 `codeload.github.com` 的 `refs/heads/main` tarball，运行态用的是官方发布二进制。**未取得精确 commit SHA**，以版本 tag 代替（见「已知缺口 G6」）。

- **面板与 Tab**：
  | panelId | 名字 | 走什么 |
  | --- | --- | --- |
  | `vibe-kanban.main` | Vibe Kanban | `ensureTool` → `.agnx/tools/ensure-vibe-kanban.mjs`，`ensureArgs: ["--port","8120"]`；`primaryPanel: true`、`iframeShortcutCapture: true` |
  | 命令 `vibe-kanban.open` | Vibe Kanban | 侧栏按钮组入口（`sidebarAction.order = 70`），`openSubAppTab` |

- **端口**：`sidecar.defaultPort = 8120`（`supervised: true`）。
  - 与已装 app 无冲突：全量扫 `$AGNX_HOME/apps/*/.agnx/manifest.json` 得 53 个 app，占用 8100–8108（openhands/omnigent/openbot/bytebot/omnibot/forge/tabtin/staffdeck 等）、3030、5173、13080 等，**无任何 app 占用 8120**；`lsof -nP -iTCP:8120` 接入前为空闲。
  - 预览反代端口由上游自己随机分配（`PREVIEW_PROXY_PORT` 缺省 = 0 自动分配，实测 51853），**不占批次端口**。

- **数据目录**：`$AGNX_HOME/apps/data/vibe-kanban/`
  - 上游用 `directories::ProjectDirs::from("ai","bloop","vibe-kanban").data_dir()`（`crates/utils/src/assets.rs`）。macOS 上它走 `~/Library/Application Support/...`，**不认 `XDG_DATA_HOME`**；所以真正的重定向由 **`HOME`** 完成：plan.env 里 `HOME=<dataRoot>/home`，数据库/配置/凭据全部落在 `<dataRoot>/home/Library/Application Support/ai.bloop.vibe-kanban/`。
  - `XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME` 一并给上，保证同一份 ensure 脚本在 Linux 上同样正确。
  - 测试用的 git 仓库放在 `<dataRoot>/projects/demo-kanban`。

- **桌面验收截图**：
  - `logs/vibe-kanban-desktop-initial.png` —— 初始态：Tab 选中高亮、上游 onboarding 界面（Coding Agent / Code Editor / Notification Sound 三列 + Continue）
  - `logs/vibe-kanban-desktop-after-action.png` —— **操作后**：Tab 选中高亮、工作区「运行中」分组里出现新建任务、右侧任务详情（demo-kanban / main / 工作分支 `vk/50fb-readme-vibe-kanb` / Git / Terminal）、底部「停止」按钮（代理已启动）

## 二、启动参数（全部是环境变量，不改代码）

| 变量 | 值 | 依据 |
| --- | --- | --- |
| `BACKEND_PORT` / `PORT` | `8120` | `crates/server/src/main.rs`：先读 `BACKEND_PORT`，再读 `PORT`，都没有则用 0 自动分配 |
| `HOST` | `127.0.0.1` | 同上，缺省即 `127.0.0.1`（显式写死以免误绑全网卡） |
| `HOME` | `<dataRoot>/home` | `crates/utils/src/assets.rs` 的 `ProjectDirs` 数据目录重定向 |
| `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` | `<dataRoot>/home/...` | Linux 同源重定向 |
| `BROWSER` | `/usr/bin/true` | 尝试压制自启浏览器（**实测无效**，见缺口 G1） |
| `RUST_LOG` | `info` | 上游日志过滤 |

## 三、首次启动耗时与复用

- **首次启动**：从宿主拉起 sidecar 到面板撤掉品牌遮罩约 **35–45 秒**（二进制 135MB 冷启动 + sqlx 建库 + 迁移 + 预加载 executor 缓存）。ensure 脚本的健康探测上限给到 180s，面板 `timeoutMs: 300_000`、`surfaceReadyTimeoutMs: 120_000`。
- **复用**：第二次开 Tab 时 ensure 先探 `http://127.0.0.1:8120/api/health`，已就绪直接返回 `{"ok":true,"reused":true,...}`，不重复 spawn（实测 `reused:true`）。
- **首次使用门槛**：上游首次进入要走 onboarding，并**强制**经过 `/onboarding/sign-in`。本机无登录场景走上游官方「跳过登录」路径（`More options` → `I understand, continue without signing in`），点击后进入 `/workspaces/create`，**无需 GitHub/Google 账号**。这是上游自带的能力，不是我们改的。

## 四、数据与会话

- 无 cookie、无 token、无登录态（跳过登录后是本地单机模式）。
- 上游首次写入 `<dataRoot>/home/Library/Application Support/ai.bloop.vibe-kanban/`（`db.v2.sqlite`、`config.json`、`profiles.json`）。
- **不做跨源状态记忆**：未启用 SKILL §5 的反代 + 桥（不需要读 DOM 记忆筛选条件；上游自己的草稿/配置已持久化在服务端）。

## 五、门闩与自验结果

| 项 | 结果 |
| --- | --- |
| A1 目录名 = manifest.id = config.appId | ✅ 均为 `vibe-kanban` |
| A2 `main` 真实存在 | ✅ `.agnx/dist/index.js` |
| A3 产物含新符号 | ✅ `grep -c "vibe-kanban"` = 7；含 `vibe-kanban.main`、`ensure-vibe-kanban.mjs`、`workspace-mini-app-` |
| A3b peer 白名单 | ✅ 产物只 `require("react")`、`require("react/jsx-runtime")` |
| A4 ensureTool 存在 | ✅ `.agnx/tools/ensure-vibe-kanban.mjs` |
| A5 图标门闩 | ✅ `PASS 1 / 1`（icon 53895B + iconDark 53895B，两者内容不同） |
| A6 贴边门闩 | ✅ `PASS 1 files` |
| A7 manifest 被 Zod 收 | ✅ `failures: []` |
| A8 端口不撞 | ✅ 8120 独占 |
| B1/B2 扫描发现 | ✅ `installState=installed`、`launchMode=packaged`、`loadSource=packaged-main`、`mainPath` 以 `.agnx/dist/index.js` 结尾、`iconPath` 非空、`failures=[]` |
| B3 侧栏格子 | ✅ `sidebar-mini-app-grid-vibe-kanban` |
| C1–C5 Tab/面板/嵌入面 | ✅ `workspace-tab-mini-app_vibe-kanban__vibe-kanban.main__default` + `workspace-mini-app-vibe-kanban-root`；面板内 iframe `src=http://127.0.0.1:8120`；文案无 `GUEST_`/`ENSURE_` |
| D1 真实操作 | ✅ 在 Tab 内：选仓库 demo-kanban → 选分支 main → 输入任务 → 点「创建」，上游生成 workspace 并启动代理 |
| D2 操作后截图 | ✅ `logs/vibe-kanban-desktop-after-action.png` |
| D4 sidecar 复用 | ✅ ensure 返回 `reused:true` |

## 六、图标

- `icon` = `.agnx/assets/icon.svg`（浅色版），`iconDark` = `.agnx/assets/icon-dark.svg`（深色版）。
- 来源：上游仓库官方 `packages/public/favicon-vk-light.svg` 与 `favicon-vk-dark.svg`（VK 方形 mark）。
- 体积处理：原文件各 67857B（超 64KB 上限），把 SVG path 里的坐标精度收到 2 位小数后各降到 **53895B**，在 150×150 图标尺寸下视觉无差别。两版底色不同（浅色版白底黑字 / 深色版黑底白字），非同一文件。

## 嵌页宿主能力缺口

| 上游能力 | 信号位置 | 嵌后风险 | 处置 (A–E) | 主路径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 启动后自动打开系统浏览器 | `crates/server/src/main.rs:108` `if !cfg!(debug_assertions) { open_browser(...) }` | 每次 sidecar 启动都可能弹出系统浏览器窗口，把用户从 Tab 引开 | **D**（接受并记录） | daemon supervisor 托管的进程通常无 GUI session 亲和性，`/usr/bin/open` 实际未生效；实测 0 个浏览器进程指向 8120 | 已尝试 `BROWSER=/usr/bin/true`（`open` crate 5.3.3 的 macOS 实现**硬编码 `Command::new("/usr/bin/open")`**，明确忽略 `BROWSER`，官方文档原文「the `BROWSER` environment variable is ignored」）；也试过 `HOME` 重定向、PATH 前置假 `open`，均无效（绝对路径）。上游无可关闭开关（`open_browser` 失败仅 `tracing::warn`，不影响服务）。**若要根治只能改上游源码，本子应用遵守「上游几乎不动」不做。** |
| `validate_origin` 中间件拒绝跨源 Origin | `crates/server/src/middleware/origin.rs`；`Origin: null` → 403、跨源 Origin → 403 | 父页是 `http://localhost:8083`，iframe 内 `fetch('/api/*')` 可能全 403 → 界面空壳 | **A**（不需处置，实测可用） | `direct-iframe` | 实测：`curl -H "Origin: null"` 和 `-H "Origin: http://localhost:8083"` 都返回 403；但**真实 Tab 内整套 UI 正常工作**（onboarding→创建 workspace→写入任务→显示在列表，全是 `/api/*` 往返）。原因：iframe 是**同源文档内的相对路径请求**（`Origin` = `http://127.0.0.1:8120` 自身，命中同源短路），并非跨源 XHR。**结论：这不是风险，不需要 guest-webview。** |
| 强制登录 onboarding | `packages/web-core/.../OnboardingSignInPage.tsx`、`routes/onboarding_.sign-in.tsx` | 首次进 Tab 会看到「Sign in to continue」，只给 GitHub/Google，用户无法使用 | **A**（走上游自带跳过路径） | 「More options」→「I understand, continue without signing in」 | 上游官方提供 `skip_sign_in`，点击后进 `/workspaces/create`，无需账号。**不登录的代价**：侧栏「Projects / Kanban Boards」只剩「Sign in to organise your coding agents with kanban boards」提示——看板视图登录后才可用。主界面 Workspaces（工作区列表 + 任务详情）完整可用。 |
| 系统目录选择器 | 上游用自绘目录浏览对话框（路径输入 + 前往 + 选择当前），非系统原生弹窗 | 无（自绘，跑在 iframe 内正常） | **A** | 在 Tab 内点「浏览」→ 填路径 → 前往 → 选择当前 | 实测通过；本子应用把测试仓库放在 `<dataRoot>/projects/demo-kanban` |
| `window.open` / 外链（Discord、GitHub、Docs） | onboarding 页右上角按钮 | iframe 内新窗口可能被拦截或跳出 Agnx | **C**（交宿主/系统浏览器） | 走宿主默认 | 属合同允许的「次要外链」，不影响主路径体验 |
| 编码代理（Claude Code / Codex 等）真实执行 | 任务详情底部「停止」按钮可见即代理已起 | 代理是本机 CLI 进程，与 iframe 无关 | **A** | 由上游 `crates/executors` 管理 | 本次验收只验证到「创建 workspace 并启动代理」，未验证长任务执行结果（无需 API key 的验收不该跑到那一步） |
| 上游 Tauri 桌面包 | `npx vibe-kanban --desktop` | 无 | **不接** | 网页形态 | 上游另有 Tauri 桌面壳，但 Agnx 要求 Tab 内贴主界面，故用服务端 + `direct-iframe`，不走桌面壳 |

## 已知缺口

| # | 缺口 | 影响 | 处置 |
| --- | --- | --- | --- |
| G1 | sidecar 启动时上游会尝试自动开系统浏览器，无环境变量可关（`open` crate 忽略 `BROWSER`，硬编码 `/usr/bin/open`） | 理论上可能弹窗；实测 supervisor 托管下未弹出（0 个指向 8120 的浏览器进程） | D：记录 + 依赖 supervisor 无 GUI 会话；根治需改上游源码，不做 |
| G2 | 不登录时「Kanban Boards / Projects」区块只显示登录提示 | 看不到旧版看板视图 | A：主界面 Workspaces 完整可用；看板需登录，属上游产品决策 |
| G3 | 未取得精确 commit SHA（GitHub API 限流 + `git clone` 超时） | 追溯精度只到版本 tag | 记录为 `vibe-kanban@0.1.44`（二进制 tag `v0.1.44-20260424091429`） |
| G4 | 二进制 135MB 落在 `.agnx/bin/`，不进版本库 | 换机需重新下载 | 从 `https://npm-cdn.vibekanban.com/binaries/v0.1.44-20260424091429/macos-x64/vibe-kanban.zip` 解压即可；ensure 缺二进制时显式报 `ENSURE_BINARY_MISSING` |
| G5 | 首次启动 35–45 秒（含 sqlx 建库迁移） | 首开感知慢 | 面板品牌遮罩 + `timeoutMs: 300s`；后续开 Tab 走 `reused:true` 秒开 |
| G6 | 验收期并行智能体（rakazo 等）用同一 CDP 抢激活 Tab，导致截图偶发拍错 Tab | 取证错位风险 | 验收脚本在每次截图前后各断言一次 `aria-selected` 与面板尺寸，两次都成立才认 |

## 附：复现步骤

```bash
export AGNX_HOME=/Users/apple/.agnx-dev
cd /Users/apple/Documents/github/agnx

# 1) 二进制（首次）
mkdir -p $AGNX_HOME/apps/vibe-kanban/.agnx/bin
curl -sL "https://npm-cdn.vibekanban.com/binaries/v0.1.44-20260424091429/macos-x64/vibe-kanban.zip" -o /tmp/vk.zip
unzip -o -q /tmp/vk.zip -d $AGNX_HOME/apps/vibe-kanban/.agnx/bin && chmod +x $AGNX_HOME/apps/vibe-kanban/.agnx/bin/vibe-kanban

# 2) 构建 + 登记 + 门闩
npm run sub-apps:build-glue -- --root=$AGNX_HOME/apps/vibe-kanban
node scripts/sub-apps/register-agnx-app.mjs --app-id=vibe-kanban --launch-mode=packaged --install-state=installed \
  --source=github --url=https://github.com/BloopAI/vibe-kanban
node scripts/sub-apps/assert-icon.mjs --paths=$AGNX_HOME/apps/vibe-kanban
node scripts/sub-apps/assert-guest-panel-edge-to-edge.mjs --paths=$AGNX_HOME/apps/vibe-kanban/.agnx/src/panel.tsx

# 3) 桌面端发现（不重启桌面端）
npm run runtime-devtools -- capture eval --expr='window.agnxDesktop.invoke("workspace_apps_reload")'
```
