# 更新日志

本项目的所有重要变更都记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

暂无。

## [0.1.0] - 2026-11-01

首个可用版本：把论文变成逐段门禁 + 批注驱动 AI 讲解的可交互精读课程。

### Added

- **多读包**：`content/<id>/` 下的读包自动发现，顶部下拉切换；进度与批注按读包分桶保存（`state.books`），切换不串。
- **逐段门禁**：每个单元「原文 → 离线讲解 → 自测 → 答对才放行」；答错先给提示、两次后给解析，可跳过并标记 `skipped`；无自测的单元直接放行。
- **批注驱动 AI**：选中句子写批注，保存后自动带上下文请 AI 讲解；回答流式渲染，可存为批注；支持「换种讲法」「更严格/更细节」「问 AI」。
- **不含示例读包**：仓库只带机制与 `content/_template/` 骨架；`content/` 默认不入版本库（避免把他人论文原文推到公网），空仓库也能构建并显示引导页。
- **本地网关代理**：`127.0.0.1:8788`（`PAPER_READER_PORT` 可改）提供静态文件与 `/api/*`；`POST /api/chat` 转发上游 OpenAI 兼容接口，把 SSE 归一化为 `{d}` / `{r}` / `{done}`；`GET /api/models` 探测可用模型。
- **AI 配置**：8 个服务商预设、自定义 Base URL / 模型 / 温度；自动发现 DSH 网关密钥；密钥只留服务端，前端仅见掩码；配置写入 `config.local.json`（`0600`）。
- **校验器**：`npm run validate` 检查 schema 版本、必填字段、章节/单元 id 唯一、跨读包 `meta.id` 唯一、`quiz.answer` 越界、`gloss.anchor` 不在原文、未配平的 `$`、KaTeX 严格渲染（`throwOnError`）与不支持宏黑名单。
- **构建器**：`content/**` → `app/packs.js`，构建前在沙箱内执行读包并校验；正文未变时保留旧时间戳，支持 `--check` 只读模式（CI 用，不写文件、不产生 diff）。
- **导入器（实验性）**：`npm run import -- --input paper.pdf --id x --title y` 从 PDF / Markdown 生成原文层读包骨架。
- **DSH 客户端插件**：`packages/plugin-dsh/` 提供右下角浮层内嵌精读器、设置分区与「批注发给当前会话」桥；`node packages/plugin-dsh/verify.mjs` 22 项离线契约校验全部 PASS；本地路径安装后重启桌面应用生效。
- **阅读体验**：通读浏览模式、章节目录与进度、字号/深色主题、Markdown 导出笔记、快捷键（←/→ 切单元、1–9 选答案、Esc 关弹窗）。

[Unreleased]: https://github.com/SFology/dsh-paper-reader/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SFology/dsh-paper-reader/releases/tag/v0.1.0
