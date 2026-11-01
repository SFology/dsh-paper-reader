# DSH 客户端插件（client plugin）机制调研

> 调研对象：本机 DeepSeek Harness 桌面版 `F:\DeepSeekHarness\`（主包 `resources\app.asar`，182,766,714 字节）
> 与用户配置目录 `C:\Users\Uranus\.dsh\`。
> 方法：写脚本按 asar 头解析 `app.asar`（**只读**），解包 13 个与插件系统相关的
> `@deepseek-ai` 包 + 已安装的第三方插件 `dsh-pet`，对照源码/README 与真实安装产物。
> 结论均标注「已核实」或「推断」。

---

## 0. 一句话结论

DSH 的「客户端插件」= **一个 npm 包**，靠 `package.json` 里的 `dsh.client`
声明浏览器半，靠 `dsh.bundle.patch` 提供一个 `cordis.patch.yml` 把自己挂进
cordis 配置树；宿主把包的 `lib/client.js` 通过 `/plugins/<包名>/client.js`
发给页面，页面用 lazy-CJS 的 `window.__ModuleLoader__` 加载，插件在自己的
Cordis `apply(ctx)` 里用 `ctx.slots.register()` 往命名槽里塞 React 组件。

**插件不需要改 asar、不需要签名**——用户插件装在 profile 目录
（`C:\Users\Uranus\.dsh\profiles\desktop\`）里，官方入口是
`dsh plugin --profile desktop add <spec>`。

---

## 1. 环境事实与解析方法

### 1.1 app.asar 的真实头部格式

任务给的描述「前 4 字节 = header JSON 长度」**不准确**，照着写会
`JSON.parse` 报 `Unexpected non-whitespace character after JSON`。真实布局是
Chromium Pickle：

| 偏移 | 内容 |
| --- | --- |
| `0..3` | uint32 LE = `4`（size-pickle 的 payload 长度） |
| `4..7` | uint32 LE = header pickle 的总长度 `H` |
| `8..11` | uint32 LE = `H` 的 payload 长度，**= 4 + jsonLen**（多出 4 字节 string 长度前缀） |
| `16..` | header JSON 正文（长度 = 上面这个值 − 4） |
| `dataBase` | `= 16 + jsonLen`；每个文件的 `offset` 相对它 |

> 所以「header JSON 从 16 开始、长度 = 读到的值减 4」。这一步搞错就会多读 4 字节
> 尾随垃圾，导致 JSON.parse 失败（本次踩过）。

`F:\DeepSeekHarness\resources\app.asar.unpacked\` 里只有一个 `dsh` 目录，
是 Electron 的 asar `unpacked` 子集（原生模块等），**不是**完整解包目录。

### 1.2 关键规模数据（已核实）

- asar 内文件总数：**18,234**
- `@deepseek-ai/*` 包：**359 个**
- 插件机制相关包：`dsh-plugin-manager`、`dsh-client-modules`、`dsh-client-hmr`、
  `dsh-cordis-client-runner`、`dsh-host-plugin-inventory`、`dsh-plugin-market`、
  `dsh-client-ui-plugin-manager`、`dsh-client-ui-settings-plugins`、
  `dsh-web-frontend`（壳）、以及 60+ 个 `dsh-client-ui-*` 面板插件。

### 1.3 用户配置目录 `C:\Users\Uranus\.dsh\`

```
.dsh\
├─ profiles\desktop\                 ← 桌面版 profile（用户插件装这里）
│  ├─ cordis.yml                     ← 空入口列表 `[]`，**不要手改**
│  ├─ cordis.patch.yml               ← 用户的 patch 层（要改就改这里）
│  ├─ package.json                   ← 依赖 + dsh.profile.bundles（有序）
│  ├─ pnpm-workspace.yaml            ← nodeLinker: hoisted
│  ├─ pnpm-lock.yaml
│  ├─ .plugin-manager\logs\          ← 安装/操作诊断日志
│  └─ node_modules\
│     ├─ @deepseek-ai\…              ← 已装的官方包
│     └─ dsh-pet\                    ← 已装的第三方插件（完整示例，含 src！）
├─ dsh-pet\                          ← dsh-pet 的**用户数据**根
├─ dsh-runtimes\  electron\  sessions\  storages\
├─ .credentials.yaml                 ← 凭据（未读取、未复制）
```

`profiles\desktop\package.json` 的核心字段（已核实）：

```json
{
  "dependencies": { "dsh-pet": "^0.3.8", "@deepseek-ai/dsh-subagent-codex": "0.2.1-rc.5" },
  "dsh": { "profile": { "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "…",
      "dsh-pet"                      ← 第三方插件 = 一个 bundle
  ] } }
}
```

`cordis.yml` 只有 `[]`，注释明确写着：
「profile root — an empty entry list. The tree is composed as patches: each
bundle in package.json's `dsh.profile.bundles`, then `cordis.patch.yml`, then
any `--patch` overlays. **Edit cordis.patch.yml, not this file.**」

这确认了配置合成顺序：
**bundle 层（按 bundles 顺序）→ profile 的 cordis.patch.yml → `--patch` 覆盖层**。

---

## 2. 插件清单字段表（package.json）

依据：官方 `dsh-client-modules` 的解析器源码（`narrowClientDeclaration` 等）
+ 官方最小客户端插件 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`
+ 第三方完整插件 `dsh-pet@0.3.8`。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `name` | ✅ | string | 包名。**同时是浏览器模块 id**、`/plugins/<name>/client.js` 的路由段、patch entry 的 `name` 值 |
| `version` | ✅ | string | 版本；与 `dsh.compatibility.dshReleases` 比对 |
| `type` | ✅ | `"module"` | 官方与第三方均为 ESM 包 |
| `main` | ✅ | string | **宿主半**入口，如 `lib/index.js` |
| `exports["./client"].default` | ✅（要 UI 时） | string | **浏览器半**入口，如 `lib/client.js`。没有它就不会被扫成客户端插件 |
| `exports["./cordis.patch.yml"]` | 建议 | string | 供工具读取 patch 文件 |
| `dsh.bundle.patch` | ✅（作为 bundle 安装时） | string | 指向本包的 `cordis.patch.yml`；**声明了它才算「bundle」**，`dsh plugin add` 才能装 |
| `dsh.client` | 要 UI 时 ✅ | object | 浏览器半声明，见下 |
| `dsh.client.platform` | ✅ | string | 实测值为 `"web"`。解析器：非 string 直接抛 `dsh.client.platform must be a string` |
| `dsh.client.inject` | ❌ | string[] | 浏览器半的**注入依赖**（其他插件包名，如 `@deepseek-ai/dsh-client-connection`）；保证被依赖插件先加载 |
| `dsh.client.external` | ❌ | string[] | 额外需要的**非基线**模块请求。基线（`PLATFORM_MODULES`）已有 `react`/`react-dom`/`cordis`/primitives 等，不用写 |
| `dsh.client.immediately` | ❌ | boolean | 是否立即 materialize（默认懒加载） |
| `dsh.compatibility.dshReleases` | 建议 | map | `{ "0.2.0-rc.1": "compatible", "0.1.7-rc.2": "incompatible" }`；商城要求最新 3 版至少 1 个 compatible |
| `icon` | ❌ | string | 插件管理页图标：svg/png/jpg/jpeg/webp，≤256 KiB，realpath 必须在包目录内（会内联成 base64 data URL） |
| `peerDependencies` | 建议 | map | 运行期由宿主提供的模块（`@deepseek-ai/cordis`、`dsh-client-*`、`react`），不打进包 |
| `files` | 建议 | string[] | npm 发布白名单：`lib`、`lib/client*.js`、`cordis.patch.yml` 等 |

### 2.1 `cordis.patch.yml`（挂载声明）

最小形态（dsh-pet 与本次原型一致）：

```yaml
- insert:
    - id: dsh-plugin-paper-reader      # 全局唯一，与包名一致；**这一行不能写行尾注释**
      name: 'dsh-plugin-paper-reader'  # 解析包入口（main）
```

要点（来自 dsh-pet 的 patch 文件注释 + plugin-manager 文档）：

- `insert:` 往配置树加 entry；entry 的 `id` 是被 patch 定位的键。
- **`id: 值` 那一行不能有行尾注释**——商城预检正则抓不到 entry id 会判
  `SUBMISSION_ENTRY_MISSING`。
- `id` 必须全局唯一；裸名（如 `pet`）会和其他插件的行 id 冲突。
- 因为 `package.json` 里有 `dsh.client`，同一个包**同时**被模块系统扫成
  浏览器插件，提供 `/plugins/<包名>/client.js`——**一个包两半，一次挂载**。

### 2.2 官方客户端插件对照（`dsh-client-ui-sidebar-documentpreview`）

```json
{ "main": "lib/index.js",
  "exports": { ".": {...}, "./client": { "default": "./lib/client.js" } },
  "dsh": { "client": { "platform": "web",
                       "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right", "…8 项"] } } }
```

注意：**官方内置插件没有 `dsh.bundle.patch`**（它们的 entry 由 `dsh-base` /
`dsh-web-app` 这些大 bundle 预先写死在配置树里）。只有「以 bundle 形式安装的
外部插件」才需要 `dsh.bundle.patch`。

---

## 3. 安装路径与启用方式

### 3.1 唯一正确的用户插件落点

**profile 目录**，桌面版 = `C:\Users\Uranus\.dsh\profiles\desktop\`。
证据链：

1. `cordis.yml` 注释：配置树 = bundles + profile patch 合成；
2. `package.json` 的 `dsh.profile.bundles` 里真实存在第三方 `dsh-pet`；
3. `node_modules\dsh-pet\` 是完整的插件包（含 `cordis.patch.yml`、`lib\client.js`）；
4. plugin-manager README：改动「影响使用该 profile 的全部会话」，安装写的是
   这个 profile 的 `package.json` / `pnpm-lock.yaml` / `cordis.patch.yml`。

**不存在** `~/.dsh/plugins` 这种目录（已核实 `.dsh\` 下无 `plugins`）。
插件是按 **npm 包**管理、按 **bundle** 选入的，不是丢进文件夹就生效。

### 3.2 官方启用命令

```powershell
dsh plugin --profile desktop add dsh-pet                     # 从 registry
dsh plugin --profile desktop add link:"<本地目录绝对路径>"     # 本地目录（开发）
dsh plugin --profile desktop list                            # 列出 bundles/行
dsh plugin --profile desktop remove dsh-pet
dsh plugin --profile desktop version-exemptions              # 兼容性豁免
```

桌面版也可以在 GUI 里：侧边栏「插件」页 / 设置 → 插件，填包名安装。
**装完必须重启桌面应用**（没有 HMR 时）。

内部动作（plugin-manager，已核实）：`pnpm add`（在 profile 目录跑，`nodeLinker: hoisted`）
→ 把包名追加进 `dsh.profile.bundles` 末尾 → 发布 runtime resolution → 重启后生效。
开关插件只改 `cordis.patch.yml` 里对应 entry 的 `disabled`。

---

## 4. 加载机制（宿主 → 页面）

依据：`dsh-client-modules`、`dsh-client-hmr`、`dsh-web-frontend` 的 README 与源码。

```
启动器读 profile（bundles → cordis.patch.yml → --patch）
        │
        ├─ Cordis 加载 Host 半：每个 entry 的 name → 包的 main（lib/index.js）
        │
        └─ Client Modules（Node 半）扫描「已启用的 Loader entry」中带 dsh.client 的包
                 │  快照 lib/client.js，按 mtimeMs/ctimeMs/size 算 revision
                 ▼
        合成 boot graph（WebBootEntry 行）→ 注入 <head>：
            window.__ModuleLoader__ 队列门面
            + 应用 combo 预加载
            + 阻塞式 bootstrap combo 脚本
            + window.__DSH_BOOT__（boot graph，`<` 已转义防注入）
                 │
                 ▼
        浏览器：Client Modules 的 ClientModuleSystem 惰性加载
            · 执行 client.js 只**注册 factory**，不跑副作用
            · 首次 materialize 时 factory(require) → exports
            · require 解析顺序：PLATFORM_MODULES 种子表 → 已 memo 模块 → boot 行 → 已注册 factory
            · require.async() 拉 compiler 生成的包内 chunk
                 │
                 ▼
        Loader 把 exports 当 Cordis 插件 { name, inject, apply } 挂进客户端树
                 │
                 ▼
        apply(ctx) 里 ctx.slots.register(...) 把 React 组件塞进命名槽 → 渲染
```

**传输形式（已核实，非 iframe、非 postMessage）**：

- 路由：`/plugins/<包名>/client.js`（combo 形式 `/plugins/??a,b&rev=<rev>`；
  单个资源超 3 KiB 会分区；`HEAD` 不物化 body）。
- 同一包的 `client.<name>.js` 惰性 chunk 也由宿主按需读文件并提供。
- 版本门禁：boot graph 带 `release`（版本 + source commit），**跨 release 的图一律不应用**，
  只能刷新页面。

**HMR（`dsh-client-hmr`，已核实，与 runtime 提示一致）**：

- 宿主对每个包的入口产物做 **stat 轮询**（`pollIntervalMs` 默认 500ms），
  通过 `/plugins/events`（SSE）推 `graph` / `rebuilt` 帧。
- `rebuilt` 到达 → 先 `invalidate` + `prefetch` 新 bundle → 拆旧 fiber、清旧样式 →
  materialize 新 exports → `entry.refresh()` 重挂载。**React 内部 state 丢失**，
  会话/connection 状态保留。
- **只有 `pnpm run dev:web`（或等价的 tsdown watch）在跑时才会有 `rebuilt` 帧**；
  只改文件不会自动重建，所以「改代码 → 自动热替换」这个体验属于源码 checkout。
  普通用户改插件代码需要**重新构建 + 重启**（或刷新页面）。
- 启用/禁用普通插件**不需要刷新页面**（图变化走同一条 SSE）。

---

## 5. 扩展点清单

### 5.1 槽（slots）—— 从 60+ 个官方客户端插件里实测提取的命名槽

在 `apply(ctx)` 里：

```js
ctx.slots.inject('shell.overlay', function* () {
  yield ctx.slots.register(
    { name: 'shell.overlay', id: 'my-widget', order: 1000, label: () => 'x', inject: () => ({ t }) },
    MyReactComponent,
  )
})
```

`register` 的 spec 字段：`name`（槽名，必填）、`id`（槽内唯一）、`order`（排序）、
`label`（函数，返回字符串，用于 tab/导航标题）、`inject`（给组件的额外 props 工厂）。

主要槽（节选，共 95 个实测）：

| 区域 | 槽名 |
| --- | --- |
| 外壳 | `shell.overlay`（浮层）、`shell.leading`、`shell.bottom`、`shell.quota-notice`、`root`、`main` |
| 侧边栏 | `sidebar`、`sidebar.footer.action`、`sidebar.session.row.leading`、`sidebar.session.row.hover`、`sidebar.workspaces`、`sidebar.panellist`、`sidebar.settings` |
| 右栏 | `rightbar`、`rightbar.session`、`sidebar.right.pane.tab`、`sidebar.right.pane.tab.title`、`sidebar.right.tab.document`(+`.action`/`.actions`)、`sidebar.right.tab.guide` |
| 对话区 | `conversation.view`、`conversation.composer`(+`.bar`/`.dock`)、`conversation.input.left`/`.right`/`.dock`/`.overlay`/`.model`/`.permission`/`.plan`/`.activity`/`.attachments`、`conversation.chat.node`、`conversation.chat.flow`、`conversation.chat.assistant-actions`、`conversation.chat.user.images`、`conversation.header`(+`.leading`)、`conversation.session.header.actions`/`.corner`/`.utilities`/`.lineage` |
| 首屏 | `conversation.hero.brand.mark`、`conversation.hero.workspace`、`conversation.hero.options`、`conversation.hero.agentPreset` |
| 设置 | `settings.section`、`settings.header`、`settings.launcher`、`settings.trigger`、`settings.general.item`、`settings.models.provider-card`、`settings.plugins.tab`、`settings.onboarding` |
| 插件管理页 | `plugins.tab`、`plugins.item`、`plugins.row.config`、`plugins.detail.actions`、`plugins.detail.section`、`plugins.detail.badge`、`plugins.add.actions`、`plugins.bundle.config`、`plugins.bundle.activation` |
| 工具/交付物 | `tool.call.toolview`、`tool.call.images`、`tool.view.cordis`、`deliverables.file.actions` |
| 其他 | `workspace.toast`、`main.conversation`、`options` |

### 5.2 客户端服务（`ctx.get(name)` / `inject` 里的名字）

实测出现过的：`slots`、`locale`、`connection`、`remote`、`remote.commands`、
`commandUi`、`uiWorkspace`、`sessions`、`webServer`、`modules`、`resources`、
`shortcuts`、`store`、`settings`、`theme`、`primitives`（图标库）。

关键的两个：

- **`ctx.locale`**：`ctx.locale.register(NS, { zh, en })` + `ctx.locale.bind(NS)`，做 i18n。
- **`ctx.remote.commands.execute(sessionId, '/cmd args', [])`**：把一条**斜杠命令**
  发给指定会话——这是客户端插件「向当前 agent 发消息」的官方路径（dsh-pet 实测用它做
  `/pet`、`/chat` 的选择框提交）。

### 5.3 宿主半可扩展的东西

- Cordis 插件生命周期：`ctx.effect(fn, label)`、`ctx.provide(name, obj)`、`inject`。
- 斜杠命令：由 `@deepseek-ai/dsh-commands` 提供（命令注册 API 本轮**未逐字确认**，
  见「坑」）。
- HTTP 路由：`@deepseek-ai/dsh-host-webserver`（dsh-pet 用 `/dsh-pet-7340/*` 提供素材）。
- 工具（给模型用的 tool）也在宿主半注册（`dsh-plugin-manager` 的 `plugin_manager`
  就是这样一个工具）。

---

## 6. 我们可用的三种集成方式 + 推荐

目标：让「精读器」把批注问题交给当前 agent。

### 方式 A：官方客户端插件（槽 + `remote.commands`）

- 做什么：客户端插件往 `shell.overlay` / `conversation.composer.dock` 注册批注面板，
  用户选完问题后 `ctx.get('remote').commands.execute(sessionId, '/annotate …', [])`，
  宿主半用 commands 服务把问题注入当前会话。
- 优点：**体验最好**，是 DSH 的正规扩展位；装一次长期可用；跟随会话上下文。
- 代价：需要一个「包 + 两份入口 + cordis.patch.yml」，装进 profile 后**重启**；
  命令注册 API 需要按 `dsh-commands` 源码对齐（本轮未逐字确认）。
- 现状：**技术完全可行**（本原型已验证静态契约 22/22），但**不能在 asar 上原地改**，
  要走 profile 安装 + 重启。

### 方式 B：只做宿主半插件（斜杠命令 / 工具 → 转外部本地服务）

- 做什么：包只声明 `main`（不声明 `dsh.client`），在宿主半注册一个 `/annotate` 命令
  或 `paper_reader` 工具，内部 `fetch('http://127.0.0.1:<port>/annotations')` 打到
  我们自己的精读器本地服务；精读器 UI 仍是自己的页面（浏览器/Electron 窗口）。
- 优点：不需要写 React、不碰前端模块系统；宿主半可用纯 Node；`dsh plugin add` 即可装。
- 代价：UI 在 DSH 之外（要自己开窗）；需要维护一个本地 HTTP 服务。

### 方式 C：零插件——文件 + 现有 agent 工具（**现在就能用**）

- 做什么：精读器把批注/问题写成 `paper-reader/annotations/<session>.jsonl`
  （或 markdown），agent 侧用现有的 `read`/`glob`/`grep` 工具读取并把问题带进对话；
  反向由 agent 写回 `answers/*.md`。
- 优点：**零安装、零重启、零风险**，今天就能跑通；跨 DSH 版本不坏。
- 代价：需要一次「读文件」的动作，不是一键直达；没有实时 UI 回推。

### 推荐

1. **立刻落地：方式 C**（写文件 + agent 读取）。稳定、无依赖，符合我们「精读器 ↔
   agent 双向」的最小闭环。
2. **体验升级：方式 A**，按 `plugin-prototype/` 这个骨架发展：
   先只注册 `shell.overlay` 面板 + 走已实测的 `remote.commands.execute`，
   宿主半的命令注册等拿到 `dsh-commands` 的确切 API 再补。
3. **不想写前端时用方式 B** 作为 A 的降级。

---

## 7. 验证命令与实际输出

### 7.1 asar 解析（只读，脚本在 `%TEMP%\dsh_asar\`）

```powershell
cd "$env:TEMP\dsh_asar"
E:\Node.js\node.exe asar.mjs tops 1
```

实际输出：

```
17188   dsh
1019    node_modules
13      lib
1       package.json
13      renderer
```

`E:\Node.js\node.exe asar.mjs list "@deepseek-ai" 400` →
`total files: 18234 matches: 7074`（`@deepseek-ai` 相关文件 7,074 个）。

### 7.2 插件原型静态契约校验（22 项，全部 PASS）

```powershell
cd "C:\Users\Uranus\Documents\科研相关\Agent相关\AgentResult\Robust_OT\paper-reader\plugin-prototype"
E:\Node.js\node.exe verify.mjs
```

实际输出（存于 `plugin-prototype\verify-output.txt`）：

```
PASS  manifest main  — "lib/index.js"
PASS  manifest exports["./client"]  — "./lib/client.js"
PASS  manifest dsh.bundle.patch  — "./cordis.patch.yml"
PASS  manifest dsh.client.platform  — "web"
PASS  manifest dsh.client.inject  — 1 项
PASS  manifest dsh.client.external  — 未声明（只用基线模块，合法）
PASS  file exists lib/index.js
PASS  file exists ./lib/client.js
PASS  file exists ./cordis.patch.yml
PASS  patch 有 1 条 insert entry
PASS  patch entry 行无行尾注释
PASS  patch name 与包名一致
PASS  client bundle 可执行            ← 在 stub 的 window.__ModuleLoader__ 里真跑
PASS  注册 factory  — id = dsh-plugin-paper-reader
PASS  factory(require) 返回模块
PASS  插件 name  — paper-reader
PASS  插件 inject  — slots, connection
PASS  插件 apply  — function
PASS  apply(ctx) 执行
PASS  槽注册  — settings.section + shell.overlay
PASS  组件 paper-reader-annotations 是函数组件
PASS  组件 paper-reader-config 是函数组件

ALL CHECKS PASSED
```

> 这个校验**不需要启动 DSH、不访问 13133**：用 `node:vm` 造一个
> `window.__ModuleLoader__` + stub `react`/`react/jsx-runtime`，真实执行
> `lib/client.js`，再拿 stub `ctx` 调 `apply()`，断言两个槽各注册了一个组件。

### 7.3 没能做（被约束限制）的验证

- **没有**在真实 GUI 里看到原型渲染：需要把它装进 profile 并重启桌面应用，
  本轮只允许写 `paper-reader/` 两个目录，故未安装。
- **没有**调用 `http://127.0.0.1:13133` 的任何 API（需 token，会 401）。
- **没有**修改 `F:\DeepSeekHarness\` 任何内容（只读）。

---

## 8. 坑（按踩到的顺序）

1. **asar 头不是「4 字节长度 + JSON」**。真实是 Pickle：JSON 从 offset 16 开始，
   长度 = `readUInt32LE(8) − 4`。弄错就多 4 字节导致 `JSON.parse` 失败。
2. **`app.asar` 文件名带 `.asar` 但是文件不是目录**；`app.asar.unpacked\` 只有
   `dsh\` 一个子树，别以为那是完整解包。
3. **插件不是「丢进目录就生效」**。DSH 用 npm 包 + pnpm workspace 管理，
   没有 `~/.dsh/plugins`；生效单元是 `dsh.profile.bundles` 里的一项。
4. **`cordis.yml` 不要手改**（它是空 `[]`，注释写明「Edit cordis.patch.yml」）；
   手改会被下次启动覆盖。
5. **`id: 值` 行不能写行尾注释**，否则商城/预检抓不到 entry id。
6. **浏览器半必须是已构建产物**（`lib/client.js`），且**不能有顶层 ESM
   `import`/`export`**——它是被当副作用脚本执行的，react 只能由 `factory(require)` 取。
   官方用 tsdown 打包；本原型是手写 IIFE，所以可直接被服务。
7. **`__ModuleLoader__.load({ id, factory })` 里的 `factory` 是
   `(require) => exports` 本体**，不是「返回 factory 的工厂」。
   写成 `factory: makeFactory`（漏了调用）会得到「插件没有 inject/apply」的怪现象
   ——因为 `Function.prototype.apply` 冒充了 `apply`，本轮踩过。
8. **没有 `pnpm run dev:web`，就没有自动热替换**。改 `lib/client.js` 后要靠
   刷新页面 / 重启（HMR 的 `rebuilt` 帧来自 bundle watcher）。
9. **跨 release 的 boot graph 会被丢弃**：DSH 升级/另一实例时页面不应用新图，
   只报 release 变化，必须刷新页面。
10. **插件宿主半跑在宿主进程里**，不受工作区沙箱限制（plugin-manager README 明说）；
    依赖构建脚本需要单独批准（pnpm 11 的 `pendingBuilds`/`allowBuilds`）。
11. **`dsh.client.external` 只写基线之外的模块**；写了 `react` 这类基线模块会被
    组合校验拒（malformed request / missing supplier / 同步环）。
12. **不要把 `icon` 指到包外**：realpath 必须留在包目录内，否则图标被忽略。

---

## 9. 关键文件索引

| 用途 | 路径 |
| --- | --- |
| 本报告 | `paper-reader\docs\dsh-plugin.md` |
| 原型 | `paper-reader\plugin-prototype\` |
| 原型清单（字段参考） | `paper-reader\plugin-prototype\package.json` |
| 原型挂载声明 | `paper-reader\plugin-prototype\cordis.patch.yml` |
| 宿主半入口 | `paper-reader\plugin-prototype\lib\index.js` |
| 浏览器半入口 | `paper-reader\plugin-prototype\lib\client.js` |
| 契约校验脚本 | `paper-reader\plugin-prototype\verify.mjs` |
| 校验实际输出 | `paper-reader\plugin-prototype\verify-output.txt` |
| 已安装的完整第三方插件（最佳范本，含 src） | `C:\Users\Uranus\.dsh\profiles\desktop\node_modules\dsh-pet\`（`package.json` / `cordis.patch.yml` / `src\client\index.ts` / `src\client\app.ts`） |
| profile 配置 | `C:\Users\Uranus\.dsh\profiles\desktop\{package.json, cordis.yml, cordis.patch.yml}` |
| 官方模块系统文档（asar 内） | `node_modules\@deepseek-ai\dsh-client-modules\README.md` |
| 官方 HMR 文档（asar 内） | `node_modules\@deepseek-ai\dsh-client-hmr\README.md` |
| 官方插件管理器文档（asar 内） | `node_modules\@deepseek-ai\dsh-plugin-manager\README.zh.md` |
