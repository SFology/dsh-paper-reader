<div align="center">

# 论文精读器 · dsh-paper-reader

**把一篇论文变成可交互的精读课程：逐段门禁、批注驱动 LLM 实时讲解、离线可读、零依赖运行。**

[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-4b5563?style=flat-square)](package.json)

[快速开始](#快速开始) · [使用指南](docs/USAGE.md) · [核心想法](#核心想法) · [读包格式](docs/CONTENT_FORMAT.md) · [架构](docs/ARCHITECTURE.md) · [DSH 插件](packages/plugin-dsh/README.md) · [路线图](ROADMAP.md)

</div>

---

## 这是个框架，不是内容库

仓库里**不带任何论文**。它提供的是把"论文 → 精读课程"这件事跑起来所需的一切机制：

- 读包格式（含严格校验：公式必须能被 KaTeX 渲染、逐句注解的锚点必须真的出现在原文里）；
- 前端阅读器（门禁、批注、SSE 流式对话、离线可用）；
- 本地服务（API Key 不出服务端）；
- DSH 插件（在 DeepSeek Harness 里浮层内嵌 + 批注桥）；
- 导入器（PDF / Markdown → 读包骨架）。

内容由你自己放进来；`content/` 默认**不入版本库**（`.gitignore` 只放行模板与你自己显式允许的目录），避免把别人的论文原文推上公网。

## 核心想法

大多数"AI 读论文"工具做的是**预置内容**：模型提前把论文嚼一遍，切成固定答案。问题是——你想问的往往不是它准备好的那些。

这个项目反过来：**你的批注就是提示词**。

1. 你读到某一句，写下一个批注（"这里为什么能这么换？"）；
2. 精读器把 *当前段落原文 + 已有讲解 + 你划出的句子 + 这条批注* 拼成上下文，**实时**发给你配的模型；
3. 回答流式返回，可以一键存回成新批注。

配合"答对自测才放行"的逐段门禁，读一篇难论文的节奏从"划过去"变成"真的过一遍"。

## 三个特点

| | |
|---|---|
| **批注即提示词** | 不是预置答案。每条批注都触发一次真实的 LLM 调用（可关掉自动触发，改成手动追问） |
| **零依赖、能离线** | 前端是纯静态页 + 内置 KaTeX，无 npm 依赖、无构建工具；双击 `app/index.html` 就能读，公式照样渲染 |
| **可嵌入 DSH** | 附带 DSH 客户端插件：在 DeepSeek Harness 里浮层内嵌精读器，批注可直接递给当前会话的 agent |

## 快速开始

```bash
git clone https://github.com/SFology/dsh-paper-reader.git
cd dsh-paper-reader

# 建第一个读包（二选一）
npm run new -- --id mypaper --title "我的论文"                       # 从零写
npm run import -- --input paper.pdf --id mypaper --title "我的论文"  # 从 PDF/Markdown 导入

# 写内容 -> 构建 -> 打开
npm run build
npm start                # http://127.0.0.1:8788/app/
```

只有 Node ≥ 18，**没有依赖要装**（`npm install` 不需要）。仓库默认 0 个读包时，页面会显示引导页，不会报错。

一步步的操作说明（建包、界面操作、配 AI、DSH 插件、常见问题）见 **[docs/USAGE.md](docs/USAGE.md)**。

其他命令：

```bash
npm run build      # content/<pack>/**  ->  app/packs.js（含内容校验）
npm run validate   # 只校验，不写文件
npm run fix        # 自动修 KaTeX 渲染不了的常见写法（\dots / \boxed / \operatorname …）
npm run dev        # 监听 content/ 变化自动重建
npm test           # node:test（schema / 构建 / 导入器 / 公式自动修复）
npm run check      # build --check + 全部测试 + 插件契约校验
```

**不想跑服务？** 直接双击 `app/index.html` 用 `file://` 打开也能读全部内容与批注；只有 AI 面板需要本地服务（浏览器不能安全持有 API Key）。

## 一篇论文怎么变成读包

每个单元（unit）就是"一屏精读"：

| 字段 | 作用 |
|---|---|
| `raw` | 原文要点（按句子切开，可逐句划线批注） |
| `explain` | 你的离线讲解（没网也能读的兜底；AI 在线时它会作为上下文） |
| `alt` / `deep` | "还没懂"换种讲法 / 进阶补充 |
| `gloss` | 逐句注解（`anchor` 必须逐字出现在 `raw` 里，校验器会检查） |
| `quiz` | 自测题（**答对才能进入下一单元**，防止"划过去"） |
| `faq` / `legend` | 常见问题 / 符号速查 |

读包是纯数据（JS 字面量，执行后 `window.PAPERS.push(...)`），字段规范见 **[docs/CONTENT_FORMAT.md](docs/CONTENT_FORMAT.md)**，骨架见 `content/_template/`。

## AI 怎么配

点右上角 **AI ⚙**：

- **预设**：USTC 网关 / DeepSeek 官方 / OpenAI / Moonshot / 通义 / Ollama / LM Studio；
- **零配置路径**：若本机已装 DeepSeek Harness 并配过网关，`server/config.mjs` 会自动读取 `~/.dsh/.credentials.yaml` 里的 key，你什么都不用填；
- **换模型**：「测试连接」会列出上游可用模型；
- **密钥安全**：key 只存在服务端（`config.local.json`，权限 600）或由服务自动发现；浏览器只拿到掩码。服务只监听 `127.0.0.1`，并校验 `Origin`（只接受本机与 `file://`），其他网页无法借道刷你的额度。

## 目录结构

```
app/                 前端（无依赖静态页）
  index.html         页面骨架：三栏（目录 / 正文 / 批注·AI·速查）
  app.js             门禁、批注、SSE 流式对话、多读包、导出
  packs.js           生成物：所有读包打成一个 JS（入库，供 file:// 使用）
  assets/katex/      KaTeX 离线资源（含字体）
server/
  index.mjs          静态服务 + /api/chat 代理（SSE 归一化）
  config.mjs         配置与密钥发现（预设、优先级、掩码）
packages/
  schema/            读包格式 v1 校验器（KaTeX 严格渲染 + 结构检查）
  importer/          Markdown / PDF → 读包（实验性）
  plugin-dsh/        DSH 客户端插件（overlay 内嵌 + 批注桥）
content/
  _template/         读包骨架（`npm run new` 用它生成新读包）
  <你的读包>/        不入库：.gitignore 默认忽略 content/*
docs/                格式规范、架构、DSH 插件机制
scripts/             build / validate / start / dev / new-pack
```

## 架构

```
┌────────────── 浏览器（app/index.html + app.js） ──────────────┐
│  读包数据（packs.js，file:// 可用）  KaTeX 离线渲染             │
│  localStorage：进度 / 批注 / 偏好（按读包分卷）                 │
└───────────────┬───────────────────────────────┬──────────────┘
                │ 静态资源                       │ POST /api/chat (SSE)
                ▼                               ▼
        ┌─────────────────── server/index.mjs ───────────────────┐
        │  静态托管（仅 127.0.0.1）   Origin 白名单                │
        │  注入 Authorization · 归一化 {d}/{r}/{done} · 超时/中断   │
        └───────────────────────────┬────────────────────────────┘
                                    ▼
                    OpenAI 兼容上游（默认 USTC 网关）
```

密钥**永远不进入浏览器**；前端只通过 `/api/config` 读到 `keyMask`。

## 安全性说明

- 监听地址固定 `127.0.0.1`（不要改成 `0.0.0.0`，那等于把 API 额度暴露给局域网）；
- `Origin` 只允许 `null`（`file://`）与 `127.0.0.1` / `localhost`；
- `config.local.json` 以 600 写入，且**不会**把自动发现的 DSH key 落盘；
- 不采集任何遥测；批注与进度只在你自己的浏览器里。

## 作为 DSH 插件

```bash
dsh plugin --profile desktop add ./packages/plugin-dsh   # 然后重启桌面应用
```

在 DeepSeek Harness 里得到：右下角「精读器」浮层（内嵌精读器）+ 设置页分区 + 批注桥（把批注连同原文递给当前会话）。细节与限制见 **[packages/plugin-dsh/README.md](packages/plugin-dsh/README.md)**。

## 路线图

见 **[ROADMAP.md](ROADMAP.md)**。近期重点：导入器稳定化、PaperQuay 适配器（只读其本地数据，不复制其 AGPL 代码）、读包版本迁移。

## 贡献

欢迎贡献机制与文档；读包内容建议留在自己的仓库（或经你确认版权后再提交）。提交前请跑 `npm run check`，规范见 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

## 许可

[MIT](LICENSE)。内置 KaTeX 资源遵循其 MIT 许可。仓库不含任何第三方论文原文；你自建的读包版权归你。
