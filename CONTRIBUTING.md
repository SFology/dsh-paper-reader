# 贡献指南

感谢你愿意改进 dsh-paper-reader。项目零依赖、零构建链，贡献门槛很低。

## 环境

- Node.js >= 18.17。
- **不要运行 `npm install`**：项目没有任何运行时依赖，装了反而会生成不该入库的 `package-lock.json`。
- 编辑器遵循 `.editorconfig`：UTF-8 无 BOM、LF 换行、2 空格缩进；Markdown 保留行尾空格。

## 常用命令

```bash
npm start                       # 构建 → 起本地服务 → 打开 http://127.0.0.1:8788/app/
npm run build                   # content/** → app/packs.js（同时校验；正文未变不产生 diff）
node scripts/build.mjs --check  # 只读构建校验（CI 用，不写文件）
npm run validate                # 只读校验已有 app/packs.js
npm test                        # node:test（pretest 会先 build）
npm run check                   # build + validate + test，提交前必跑
node packages/plugin-dsh/verify.mjs   # DSH 插件离线契约校验（改插件时必跑）
```

提交前请至少确认以下命令全部通过：

```bash
npm run check
```

`app/packs.js` 是**入库的生成物**（供 `file://` 直接打开）。若你改动了 `content/**`，请运行 `npm run build` 并把重新生成的 `app/packs.js` 一起提交；正文没变时构建会沿用旧时间戳，不会制造无意义的 diff。CI 用 `node scripts/build.mjs --check` 校验源可构建且与产物一致。

## 读包贡献规范

读包是内容，也是数据，必须能被校验器和渲染层同时接受：

1. **必须过校验**：`npm run validate` 零 error（warning 可见但不阻塞；新增内容尽量不引入新的 warning）。
2. **公式只用 KaTeX 子集**：`\frac \sqrt \sum \prod \langle \rangle \mathbb \mathrm \mathcal \| \le \ge \to \mapsto \in \subset \inf \sup \max \min \ldots \cdots` 等可用；**不要用** `\dots`（改 `\ldots` / `\cdots`）、`\overset`、`\underset`、`align` 环境、`\label`、`\ref`。
3. **中文写在公式外**：`\text{中文}` 不被支持；中文放 `$…$` 之外。
4. **源码用 `String.raw`**：读包 JS 里所有含 LaTeX 的字符串必须是 `String.raw\`...\`` 模板，否则 `\f`、`\t`、`\n` 会被 JS 转义破坏。
5. **`gloss.anchor` 必须是 `raw` 去掉公式后的逐字子串**（忽略空白）；不是「大致相同」。
6. **`quiz.answer` 是 0 起的正确项下标**，必须在 `options` 范围内；建议每题都写 `hint` 与 `why`。
7. **公式分隔符必须配平**：`$…$` 与 `$$…$$` 成对出现，未配平的 `$` 会被校验器直接判错。
8. **`meta.id` 唯一、URL 安全**（小写字母/数字/`.`/`_`/`-`）；章节与单元 id 在读包内唯一。
9. 新增读包放在 `content/<id>/`，`00_pack.js` 声明 `meta` 并注册读包，后续文件按文件名顺序 push 章节；不要改动既有读包的结构性约定。

完整字段与示例见 [docs/CONTENT_FORMAT.md](docs/CONTENT_FORMAT.md)。

## 代码贡献

- 前端是原生 JS（无框架），保持 `app.js` 单文件与 `file://` 可用性；不要引入构建步骤或 CDN 依赖。
- 服务端只用 Node 内置模块。端口用 `PAPER_READER_PORT`（默认 8788）；新增路由要同步 `docs/ARCHITECTURE.md` 的路由表。
- 变更读包格式或校验规则时，同步更新 `docs/CONTENT_FORMAT.md`、`docs/ARCHITECTURE.md` 与 `packages/schema/schema.mjs`（它是格式的唯一事实来源）。
- 新增功能请补 `tests/` 下的 `node:test` 测试（不要新增 npm 依赖）。
- 改 DSH 插件（`packages/plugin-dsh/`）时，先跑 `node packages/plugin-dsh/verify.mjs`；装进本机验证用 `dsh plugin --profile desktop add ./packages/plugin-dsh`，安装后**必须重启桌面应用**才会装配。

## Commit message 约定

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>(<scope>): <subject>

[optional body]
```

常用 type：

- `feat`：新功能
- `fix`：缺陷修复
- `docs`：文档
- `test`：测试
- `content`：读包内容（新增/修订论文）
- `refactor`、`chore`、`ci`：重构、杂务、CI

示例：

```text
feat(app): 支持把 AI 回答存为批注
content(mypaper): 补第 1 章 3 个单元的自测解析
docs: 补充本地网关的密钥安全约定
```

## PR 检查清单

- [ ] `npm run check` 通过（build + validate + test）
- [ ] 若改了 `content/**` 或读包格式，已重新生成并提交 `app/packs.js`
- [ ] 若改了 `packages/plugin-dsh/`，`node packages/plugin-dsh/verify.mjs` 全部 PASS
- [ ] 新增/修改的公式在页面上能正常渲染（KaTeX 子集）
- [ ] 文档与代码一致（命令、端口、路由、字段没有臆造）
- [ ] 未提交 `config.local.json`、密钥、日志等本地文件
- [ ] commit message 符合 Conventional Commits
