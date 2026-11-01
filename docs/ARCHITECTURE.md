# 架构与设计决策

这份文档解释 dsh-paper-reader 为什么长成现在这样：分层结构、几个不显然的取舍、数据怎么流动、扩展点与当前明确不做的部分。

## 总览

精读器是「**纯静态前端 + 可选本地网关 + 薄 DSH 插件**」的组合：

- 前端（`app/`）不依赖任何构建工具与第三方框架，KaTeX 以本地资源引入，`file://` 直接可读。
- 读包（`content/**`）是纯数据，构建期拼成 `app/packs.js`，随页面脚本加载。
- 需要 AI 时，只监听回环地址的小服务（`server/`）代替浏览器持有 API Key，并把上游 SSE 归一化。
- 想嵌入 DSH 时，`packages/plugin-dsh/` 提供一个客户端插件：浮层内嵌精读器页面 + 批注桥，本体不改。

## 分层

| 层 | 职责 | 关键文件 |
|---|---|---|
| pack 数据层 | 读包格式、结构校验、构建与产物 | `content/<id>/*.js`、`packages/schema/schema.mjs`、`packages/schema/validate.mjs`、`scripts/build.mjs`、`app/packs.js` |
| 渲染层 | 单元阅读、门禁、批注、目录、进度、AI 面板 | `app/index.html`、`app/app.js`、`app/styles.css`、`app/assets/katex/` |
| 服务层 | 静态文件、配置与密钥发现、LLM 代理与 SSE 归一化 | `server/index.mjs`、`server/config.mjs` |
| 插件层 | 把精读器嵌进 DSH：浮层、设置分区、批注桥 | `packages/plugin-dsh/`（`package.json`、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`、`verify.mjs`） |

层与层之间只通过稳定接口耦合：渲染层读 `window.PAPERS` 与 `/api/*`；数据层与渲染层共享同一套公式切分语义（`tokenizeMath` / 前端 `tokenize` 行为一致）；插件层通过 iframe 内嵌精读器页面，并用 `postMessage` 把批注递出去。

## 关键设计决策

### 为什么 pack 是 JS 而不是 JSON

`file://` 页面无法用 `fetch` 读本地 JSON（浏览器把每个文件当成独立来源），而「双击就能读、断网能读」是产品硬约束。因此读包必须随 `<script>` 加载：执行后 `window.PAPERS.push(pack)`。

代价与对策：

- 读包 = 可执行代码，需要执行期校验。构建器和校验器都在 Node 里用 `new Function('window', ...)` 执行读包（`loadPacksInSandbox`），拿到 `window.PAPERS` 后做结构校验。
- 一篇论文拆成多个文件维护（`00_pack.js` 声明 meta，`01_*.js` 起往 `chapters` 里 push），构建时按文件名排序拼接，所以**命名前缀就是执行顺序**。
- LaTeX 反斜杠必须用 `String.raw`，否则 `\f`、`\t`、`\n` 会被 JS 转义吃掉；这是读包作者最容易踩的坑，见 `docs/CONTENT_FORMAT.md`。
- `app/packs.js` 是**提交入库的生成物**（`file://` 用户拿到的就是它）。构建时正文与文件头时间戳分开处理：正文没变就沿用旧时间戳，避免每次构建都产生 diff。CI 用 `node scripts/build.mjs --check` 做只读校验（不写文件、不产生 diff）。

### 为什么需要本地代理

浏览器里放 API Key 等于公开 Key：任何扩展、开发者工具、页面脚本都能读走；同时浏览器直连上游还会遇到 CORS。所以引入一个本机进程：

- 只监听 `127.0.0.1:8788`（`PAPER_READER_HOST` / `PAPER_READER_PORT` 可覆盖），浏览器经 `/api/chat` 同源（或 `file://` 跨到回环地址）访问；
- 由服务端注入 `Authorization: Bearer <key>`，密钥永远不下发；
- 统一不同上游的 SSE 差异，前端只看到 `{d}`（内容增量）、`{r}`（推理增量）、`{done}`、`{error}`；
- 统一超时与 401/404/429 的错误提示，前端不必理解每家网关的报错格式。

没有服务时，前端会明确提示「AI 助教需要一个本地网关」，并退化为离线阅读 + 「复制提问」手动带去其它对话工具。

### 为什么门禁是「答对才放行」

逐段学习模式强制**主动回忆**：读完一段必须答对自测题，「我懂了，继续」才会解锁。目的不是考试，而是让误解在进入下一段前暴露出来——否则读者会一路点「下一段」，产生虚假的流畅感。

实现上保留了必要的逃生口：

- 答错先给 `hint`，错两次后给 `why` 解析；
- 「跳过」按钮会把单元标记为 `skipped` 并允许继续（进度统计上不算已掌握）；
- 无 `quiz` 的单元（纯速查卡）直接放行；
- 批注与「还不懂，问 AI」始终可用，门禁只拦「继续」，不拦提问。

进度条只统计 `learned`，跳过的单元不计入，避免进度数字自我欺骗。

### 其它决策

- **离线优先**：`explain / gloss / quiz / faq / legend` 全部写进读包；LLM 是增强，不是前提。
- **零依赖**：只用 Node 内置模块与原生浏览器 API，降低维护成本、避免供应链风险。
- **前端无框架**：单文件 `app.js` 足够，换来零构建步骤与 `file://` 可用性。
- **状态存 localStorage**：主键 `paper-reader-v1`，多读包进度与批注按读包分桶（`state.books[packId].cur/prog/ann`），切换读包不串。
- **薄插件 + 厚网页**：DSH 插件只负责「嵌入」与「把批注递进去」，精读器本体保持独立可运行，避免与 DSH 的 UI 契约绑死（取舍细节见 `packages/plugin-dsh/README.md`）。

## 数据流

### 阅读与门禁

1. `scripts/build.mjs` 拼接 `content/<id>/*.js` → `app/packs.js`。
2. 页面依次加载 `katex.min.js`、`packs.js`、`app.js`；`app.js` 过滤出有 `chapters` 的读包，默认选第一个。
3. `renderStudy()` 按 `raw` 切句（`sentenceize`），给每个句子 `sid`，渲染原文、离线讲解、`alt/deep`、自测、门禁；目录、进度、右侧速查同步刷新。
4. 自测选择写入 `state.prog[pid].answers`；全部答对（`quizAllCorrect`）或 `learned/skipped` 时下一步解锁；状态经 `save()` 落到 localStorage。

### 选中句子 → 批注 → AI → 可存为批注

1. 用户在「原文要点」里选中文字，工具条出现，点「批注」。
2. 保存为 `{ id, sids, quote, note, ts }`，存入 `state.ann[pid]` 并高亮对应句子。
3. 若开启「保存批注后自动讲解」（默认开），触发 `askAI(note)`。
4. `ctxOf()` 拼接上下文：`【论文】`、`【当前单元】`、`【原文】`、`【已有离线讲解（仅作参考）】`、`【预置逐句注解】`、`【我划出的原文】`、`【我的批注】`；`buildSYS()` 再注入读包 `meta.assistant`（persona / hints / glossary）与内置规则。
5. `payload()` 取最近 8 条消息与 system 提示，`POST /api/chat`。
6. 服务端 `loadConfig()` 取密钥并注入请求头，请求上游 `/chat/completions`（`stream: true`），把分片解析为 `{d}` / `{r}` / `{done}` 的 SSE 事件；前端逐段渲染，可随时中止。
7. AI 回答可「存为批注」：回到第 2 步，形成「批注 → 讲解 → 新批注」的循环。
8. 导出笔记（`.md`）汇总进度、批注与 AI 问答。

### 服务端路由

| 路由 | 说明 |
|---|---|
| `GET /` | 302 → `/app/` |
| `GET /app/*` | 前端静态文件（限制在 `app/` 内，防目录穿越） |
| `GET /api/config` / `POST /api/config` | 公开配置（密钥仅掩码）/ 保存配置到 `config.local.json` |
| `GET /api/models` | 探测上游可用模型 |
| `GET /api/papers` | 读包清单（id/title/subtitle/lang/units/version） |
| `POST /api/chat` | 上游对话，SSE 归一化为 `{d}` / `{r}` / `{done}` |
| `GET /api/health` | 健康检查（版本、uptime） |
| `POST /api/stop` | 优雅退出本地服务 |

## 扩展点

- **加读包**：`content/<新 id>/`，或 `npm run new` / 复制 `content/_template/`；无需改代码。
- **加公式宏**：若需放宽 KaTeX 限制，同步更新 `packages/schema/schema.mjs` 的 `UNSUPPORTED_MACROS`。
- **加题型**：`app.js` 的 `choose / quizAllCorrect` 与 `packages/schema/validate.mjs` 的 `quiz` 校验一起扩展（v1 只支持单选）。
- **加导入源**：`packages/importer`（实验性）按 `content/<id>/*.js` 输出骨架；新格式只需产出同样的骨架。
- **加服务商**：`server/config.mjs` 的 `PRESETS`；任意 OpenAI 兼容端点也可手填。
- **插件接入**：`GET /api/papers` 与 `/api/chat` 已足够；插件机制见 `docs/DSH_PLUGIN.md`，用法见 `packages/plugin-dsh/README.md`。
- **导出格式**：`app.js` 的 `exportNotes()` 目前输出 Markdown，可扩展 JSON 备份。
- **读包版本迁移**：`meta.version` 已预留，迁移策略见 `ROADMAP.md` v0.2。

## 已知限制

- **只用 OpenAI 兼容协议**：`/api/chat` 依赖 `choices[].delta.content` 与可选 `reasoning_content`；非兼容上游需另写适配。
- **单用户、单浏览器**：进度与批注只在 localStorage，不跨设备、不跨浏览器、无协作；清缓存即丢。导出 Markdown 是唯一备份途径。DSH 插件内嵌的 iframe 属于 `127.0.0.1:8788` 源，与 DSH 页面不同源，存储刻意分离。
- **插件依赖本地服务**：插件不自带 LLM、也不启动子进程；用前先 `npm start`。安装后必须重启 DSH 桌面应用才会装配；免启动 DSH 的离线契约校验是 `node packages/plugin-dsh/verify.mjs`（当前 22 项 PASS）。
- **插件发送能力受 DSH 版本影响**：`remote.commands.execute` 在部分版本不接受纯文本，失败会自动降级为剪贴板。
- **导入器是实验性的**：PDF 公式与章节切分启发式不稳定，只保证原文层，教学层需人工/LLM 补写。
- **读包格式无迁移**：schema 目前只有 v1，加载时不兼容旧/新版本；版本迁移在 v0.2 规划中。
- **性能边界**：所有读包一次性打进 `app/packs.js`（仓库默认 0 个读包，产物约 0.2 KB；公式统计口径见 `packages/schema/validate.mjs`），读包很多或很大时应改为按需加载（也是插件层后续要解决的问题）。
- **没有鉴权**：本地服务的安全性完全依赖「只监听回环地址」与 Origin 白名单；不要暴露到公网。
