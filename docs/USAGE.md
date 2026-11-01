# 使用指南

面向"我现在就要读一篇论文"的场景，从起服务到放进 DSH，逐条可复制。

## 0. 三种用法，按需要挑

| 形态 | 需要什么 | 能做什么 |
|---|---|---|
| **直接双击** `app/index.html` | 只要浏览器 | 阅读、逐段门禁、批注、导出笔记（公式正常渲染）。**没有 AI**——`file://` 页面不能安全持有 API Key |
| **`npm start`**（推荐） | Node ≥ 18 | 上面全部 + **实时 AI 助教**（批注即提示词）+ 模型配置 + 多读包切换 |
| **DSH 插件** | 上面 + DSH 桌面版 | 在 DeepSeek Harness 里浮层内嵌精读器，批注可直接递给当前会话的 agent |

没有读包时打开页面会看到引导页，这是正常的：**本仓库只带机制，不带论文内容**。

## 1. 起服务（30 秒）

```bash
cd dsh-paper-reader
npm start
```

浏览器会自动打开 <http://127.0.0.1:8788/app/>。

- 换端口：`npm start -- --port 8790`
- 不自动开浏览器：`npm start -- --no-open`
- 只用静态页（不要 AI）：直接双击 `app/index.html`

`npm start` 每次都会先重建 `app/packs.js`，所以改完内容只要重启/刷新即可。

## 2. 建第一个读包

### 方式 A：从 PDF 导入（最快，先用它生成骨架）

```bash
npm run import -- --input "C:\path\to\paper.pdf" --id mypaper --title "我的论文"
npm run build
```

生成 `content/mypaper/00_pack.js` + `01_body.js`：PDF 文本按标题切章、按段落切单元。

- 导入器会剥掉页眉页脚、合并断词，但 **PDF 没有 LaTeX 层，公式是纯文本**——公式要自己改写成 `$...$`；
- `explain` 字段是占位符，需要你自己补（这是精读的价值所在）；
- 想保留公式，优先用 Markdown 源导入：`--input notes.md`。

### 方式 B：从零写

```bash
npm run new -- --id mypaper --title "我的论文"
# 编辑 content/mypaper/01_body.js
npm run build
```

`content/_template/` 是骨架参考，字段表见 [CONTENT_FORMAT.md](CONTENT_FORMAT.md)。

### 方式 C：一页页手抄进读包

适合"边读边做笔记"：读一段，把原文要点抄进 `raw`，把理解写进 `explain`，把卡点写进 `gloss`。

## 3. 界面怎么用

三栏：**左目录 / 中正文 / 右批注·AI·速查**。

顶部：

| 控件 | 作用 |
|---|---|
| 读包下拉 | 多篇论文切换，进度与批注按读包分开存 |
| 进度条 + `n / N` | 已完成单元数 |
| **逐段学习** | 一次一屏；答对自测才放行（`我懂了，继续 →` 才会亮） |
| **通读浏览** | 连续滚动，不做门禁，适合复习 |
| `A− / A+ / ◐` | 字号、深浅色 |
| **导出笔记** | 生成 Markdown（进度 + 批注 + 来源），可直接存档 |
| **AI ⚙** | 模型与密钥设置 |
| **?** | 内置使用说明 |

正文里：

- 鼠标**选中句子** → 弹出菜单 → 批注 / 问 AI；
- 单元底部按钮：`换种讲法`（看 `alt`）、`上一段`、`我懂了，继续 →`、`跳过`（需确认）；
- 自测答错会给出 `hint`，答对给 `why`。

右栏三个标签：

- **批注**：本单元/全书批注列表，可编辑、删除、定位；
- **AI 助教**：流式回答；`保存为批注` 把回答存回去；可中断；
- **速查**：单元级符号表 `legend` + 常见问题 `faq`。

批注弹窗里 **Ctrl+Enter** 保存。AI 面板顶部可切换"保存批注后自动请 AI 讲解"。

## 4. 配 AI

打开 `AI ⚙`：

1. **预设**：USTC 网关 / DeepSeek / OpenAI / Moonshot / 通义 / Ollama / LM Studio；
2. 填 Base URL、Key、模型名 → **测试连接**（会列出上游可用模型）→ **保存并启用**。

零配置路径：如果本机装过 DeepSeek Harness 并配过网关，服务会自动读 `~/.dsh/.credentials.yaml` 里的 key，界面只显示掩码（如 `sk-p…o-0Q`）。

安全边界：

- Key 只存在服务端 `config.local.json`（权限 600），**不落浏览器**；
- 服务只监听 `127.0.0.1`，并校验 `Origin`（仅本机与 `file://`）；
- 自动发现的 DSH key 不会被写进 `config.local.json`。

## 5. 放进 DSH（可选）

```bash
dsh plugin --profile desktop add ./packages/plugin-dsh
# 然后重启 DSH 桌面应用（客户端插件只在启动时装配）
```

重启后，任意会话右下角出现「精读器」按钮：

- 点开是浮层内嵌的精读器（先在项目目录 `npm start`）；
- 在精读器里保存批注 → 浮层右下角弹出卡片 → **发给当前会话**（失败自动降级为复制到剪贴板）；
- 设置页新增「精读器」分区：改服务地址、测连通、开关内嵌。

卸载：`dsh plugin --profile desktop remove dsh-plugin-paper-reader`。

## 6. 日常迭代节奏

```bash
npm run dev      # 监听 content/，改完自动重建（另开一个终端 npm start）
npm run fix      # 自动修不可渲染的 LaTeX 写法（\dots / \boxed / \operatorname …）
npm run validate # 只校验不写文件（与 CI 同一套规则）
npm run check    # build --check + 36 项测试 + DSH 插件契约，提交前跑这个
```

公式与校验规则（会自动帮你抓）：

- 行内 `$...$`、独立 `$$...$$`；
- 不支持的写法：`\dots`（用 `\ldots`）、`align` 环境、`\text{中文}`、`\label`/`\ref`、`\overset`/`\underset`；
- 每个公式都必须能被 KaTeX 严格渲染，否则 `build` 直接失败并指出文件与单元；
- `gloss` 的 `anchor` 必须**逐字**出现在 `raw` 里（校验器会查）。

## 7. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 打开就是引导页 | `app/packs.js` 里 0 个读包：确认 `content/<id>/00_pack.js` 存在、`meta.id` 正确，然后 `npm run build` |
| 改了内容页面没变 | 忘了 `build`（或没刷新）；`Ctrl+F5` 强刷 |
| 端口被占 | `npm start -- --port 8790`，或设环境变量 `PAPER_READER_PORT=8790` |
| AI 一直"未连接" | 服务没起 / 是用 `file://` 打开的 / key 无效 → 点 `AI ⚙` → 测试连接 |
| PDF 导入后公式全变纯文本 | PDF 无 LaTeX 层，正常；公式手写或改用 Markdown 源 |
| 导入后 `explain` 是占位符 | 设计如此：讲解必须人来写，或让 AI 在"问 AI"里边读边生成 |
| 导入后一堆"KaTeX parse error" | 内置 KaTeX 是精简版：先 `npm run fix` 批量改（`\dots`、`\boxed`、`\operatorname` 等），再 `npm run build`；剩下的 `\text{中文}`、`\overset` 需要手改 |
| 我的读包会不会被 push | 不会：`content/*` 默认被 `.gitignore` 忽略；想公开某个读包就在 `.gitignore` 里加 `!content/<id>/` |
| 批注/进度存在哪 | 浏览器 localStorage（按读包分桶），换浏览器/清缓存会丢；需要长期保存请用"导出笔记" |

## 8. 命令速查

| 命令 | 作用 |
|---|---|
| `npm start` | 构建 + 起服务 + 开浏览器 |
| `npm run dev` | 监听 `content/` 自动重建 |
| `npm run build` | `content/**` → `app/packs.js`（含校验） |
| `npm run validate` | 只校验 |
| `npm run new -- --id <id> --title "<标题>"` | 新建读包骨架 |
| `npm run import -- --input <file> --id <id> --title "<标题>"` | 从 PDF / Markdown 导入 |
| `npm run fix` | 自动修不可渲染的 LaTeX 写法（`--dry` 只看不改） |
| `npm test` / `npm run check` | 测试 / 提交前全量检查 |
| `node packages/plugin-dsh/verify.mjs` | DSH 插件契约自检 |
