# 内容格式（Pack Format v1）

精读器把一篇论文/文档叫作一个 **pack（读包）**。读包是纯数据：一个 JS 文件（或一个目录下若干按序拼接的 JS 文件），执行后把自己 push 进 `window.PAPERS`。

- 无需构建工具、无需网络、`file://` 直接可读（这是刻意的设计约束）。
- 公式用 KaTeX 语法，`$...$` 行内、`$$...$$` 独立成段。
- 校验器：`npm run validate`（严格渲染所有公式、检查锚点与答案索引、检查 id 唯一性）。

## 目录约定

```
content/
  my-paper/                 # pack id = my-paper（目录名即 id）
    00_pack.js              # 声明 meta，注册 pack
    01_intro_models.js      # 之后每个文件往 P.chapters 里 push
    02_cost_lift.js
    ...
  _template/
    00_pack.js              # 复制这个目录开始写新读包
```

`scripts/build.mjs` 按**文件名排序**拼接 `content/<id>/*.js`，前面插入 `window.PAPERS = [];`，输出 `app/packs.js`（提交入库，供 `file://` 用户直接打开）。

## 读包对象

```js
// content/<id>/00_pack.js
window.PAPERS = window.PAPERS || [];
window.__PACK__ = {
  schema: 1,
  meta: {
    id: 'my-paper',                        // 必填，唯一，URL 安全
    title: '我的论文',          // 必填
    subtitle: '利用共享支持点不确定性的几何结构',
    authors: ['…'],
    year: 2025,
    venue: 'ICML',                     // 可选
    url: 'https://arxiv.org/abs/…',    // 可选
    license: 'CC-BY-4.0',              // 可选：原文版权
    lang: 'zh',                        // 'zh' | 'en'
    source: 'paper.pdf · 23 页 · 精读重组',
    tags: ['最优传输', '鲁棒优化'],
    abstract: '…',                     // 可选
    version: '1.0.0',                  // 读包自身版本（内容修订时递增）
    readingTime: '45m',
    assistant: {                       // 可选：给 AI 助教的领域信息
      persona: '你熟悉最优传输与凸优化',
      discipline: 'math',
      glossary: [{ term: 'Π(a,b)', def: '运输多面体' }],
      hints: '读者是研究者，别做科普'
    }
  },
  chapters: []
};
window.PAPERS.push(window.__PACK__);
```

后续文件：

```js
// content/<id>/01_xxx.js
(function () {
  var r = String.raw;              // 必须用 String.raw，否则 LaTeX 反斜杠会被吃掉
  var P = window.__PACK__;
  P.chapters.push({ id: 'c1', num: '1', title: '…', intro: '…', paras: [ /* unit… */ ] });
})();
```

## 章节（chapter）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | pack 内唯一 |
| `num` | string | | 显示编号，如 `'3'`、`'附'` |
| `title` | string | ✓ | |
| `intro` | string | | 章首导语（可含公式） |
| `paras` | unit[] | ✓ | 学习单元（一段 = 一个学习单元） |

## 学习单元（unit / para）

一个单元 = 页面上的一屏：原文 → 讲解 → 自测 → 放行。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | pack 内唯一，建议 `c3p2` |
| `title` | string | ✓ | 单元标题（目录里显示） |
| `raw` | string | ✓ | 原文要点（可轻度改写以补全公式，但不应改变论断） |
| `explain` | string | ✓ | 离线讲解（无 LLM 时的主要阅读材料） |
| `alt` | string | | 换种讲法（点「还没懂」时显示） |
| `deep` | string | | 更严格/更细节（折叠区） |
| `tags` | string[] | | 如 `['核心','易错']` |
| `objectives` | string[] | | 本单元要掌握的点（可选，UI 逐渐启用） |
| `source` | object | | `{ page, section, quote }`，便于回原文核对 |
| `gloss` | object[] | | 逐句注解 `{anchor, note}`；**anchor 必须逐字出现在 raw 的纯文本中**（去掉公式后） |
| `quiz` | object[] | | 自测题，见下 |
| `faq` | object[] | | `{q, a}` 常见疑问 |
| `legend` | object[] | | `{sym, desc}` 符号表（`sym` 可含公式） |

### quiz

```js
{ q: '为什么逐边膨胀无效？',
  options: ['因为…', '因为…', '因为…'],   // ≥2 项，建议 2–4
  answer: 1,                             // 正确项下标（0 起）
  hint: '看目标里依赖 P 的部分',           // 答错时的提示
  why: '膨胀成本 = D(P)+T，T 为常数' }     // 解析（答对或错两次后显示）
}
```

无 `quiz` 的单元直接放行（用于纯速查卡）。

### 公式约定（内置 KaTeX 是精简版，非完整 LaTeX）

内置的 `app/assets/katex/` 是离线精简构建，比完整 KaTeX 少了若干宏。校验器按下面这张表拦截（`packages/schema/schema.mjs` 的 `UNSUPPORTED_MACROS` 是唯一事实来源）：

- 支持：`\frac \tfrac \dfrac \sqrt \sum \prod \int \langle \rangle \mathbb \mathrm \mathbf \mathcal \left\| \right\| \le \ge \to \mapsto \in \setminus \subset \inf \sup \max \min \ldots \cdots \bigl( \bigr)`，以及 `aligned` 环境、`\text{English}`
- **不支持**（校验会直接报错）：

| 写法 | 改成 |
|---|---|
| `\dots` | `\ldots` / `\cdots` |
| `\boxed{X}` / `\fbox{X}` / `\colorbox{c}{X}` | 去掉外框，只留 `X` |
| `\tag{n}` | 把编号写成正文文字 |
| `\operatorname{X}` / `\mathop{X}` | `\mathrm{X}` |
| `\bm{X}` / `\boldsymbol{X}` | `\mathbf{X}` |
| `\underbrace{X}_{Y}` | `(X)_{Y}` |
| `\overbrace{X}^{Y}` | `(X)^{Y}` |
| `\substack{X}` | 拆成多行公式 |
| `\overset` / `\underset` / `\label` / `\ref` | 改写为文字或去掉 |
| `align` 环境 | `$$…$$` 分段，或改用 `aligned` |
| `\text{中文}` | 中文移到 `$…$` 之外 |

前 11 类可以用工具批量改：

```bash
npm run fix                 # 修 content/ 下所有读包
npm run fix -- content/foo  # 只修一个
npm run fix -- content/foo --dry   # 只看会改什么
```

`\text{中文}`、`\overset` 这类改法取决于语义（中文该放在公式哪个位置），工具不碰，只留报错让你手改。

- 中文一律写在 `$…$` 之外。
- 源码里必须用 `String.raw` 模板字符串，否则 `\f`、`\n`、`\t` 会被 JS 转义。

## 校验与构建

```bash
npm run validate     # 严格校验（KaTeX throwOnError + 结构检查）
npm run fix          # 自动修常见不可渲染写法（\dots / \boxed / \operatorname …）
npm run build        # content/**  ->  app/packs.js
npm test             # node:test：schema 校验 + 构建一致性
```

校验规则清单（`packages/schema/validate.mjs`）：

1. `meta.id` 唯一、`meta.title` 非空、`schema === 1`
2. 章节/单元 id 在 pack 内唯一
3. `raw`、`explain` 必填
4. `quiz.answer` 在 `options` 范围内
5. `gloss.anchor` 出现在 `raw` 纯文本中（去掉 `$…$` 后、忽略空白）
6. 所有公式能被 KaTeX 严格渲染
7. 跨 pack 的 `meta.id` 不重复

## 从 PDF / Markdown 生成读包

```bash
npm run import -- --input paper.pdf --id mypaper --title "…" --lang zh
npm run import -- --input notes.md --id mynotes --title "…"
```

`packages/importer` 会：抽取文本 → 按标题/段落切分 → 生成骨架 pack（`raw` 填原文，`explain` 留空待补，公式保留原始 LaTeX）→ 输出到 `content/<id>/`。

> `explain / gloss / quiz` 这些"教学层"仍需人或 LLM 补写；导入器只保证**原文层**可用。这是有意的：精读器的价值在于教学层，而不是 PDF 转文本。

## 导入器实现说明

- 用法：`node packages/importer/cli.mjs --input <file.md|file.pdf|file.txt> --id <packId> --title "标题" [--lang zh] [--out content/<id>] [--max-units 40] [--no-placeholder] [--force]`（亦可 `npm run import -- …`）。
- 输出：`content/<id>/00_pack.js`（`meta` + `window.__PACK__`）与 `01_body.js`（每章 `P.chapters.push`；`raw` 为清洗后原文，`explain` 为占位）；`--out` 相对项目根，目录已有文件时需 `--force`。
- 自检：用 `packages/schema/validate.mjs` 的 `validatePack` 跑结构校验；KaTeX 不可用时自动退化为结构检查（不崩），打印章/单元/公式/警告统计，有 error 时退出码 1。
- 切分：`#` 成章，`##`/`###` 作为节标记（当前章达 `--max-units` 或尚无章时自成章，超限自动「（续）」章）；连续非空行为一个单元，超 ~1200 字符按句子边界切；代码块保留、`$…$`/`$$…$$` 原样保留，其余 Markdown 语法剥除。
- PDF：`pdf.py` 用 PyMuPDF 抽取（文本块按 y 排序、去出现率 >60% 的页眉页脚短行、合并行尾 `-` 断词），`pdf.mjs` 用 `spawnSync` 调用；识别出 ≥2 个标题则每标题一章，否则每 3 页一章、章名 `第 N 页`；缺 PyMuPDF 时报「未找到 PyMuPDF 解释器…」。
- 限制：不生成教学层（`explain/alt/deep/gloss/quiz/faq` 需人/LLM 补写）；PDF 只得到纯文本、无法还原公式 LaTeX（公式只能来自 Markdown）；不处理多栏排版、表格、图片、扫描件（无 OCR）；标题识别为启发式，可能误判。
