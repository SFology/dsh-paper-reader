#!/usr/bin/env node
/**
 * cli.mjs — 读包导入器 CLI。
 *
 *   node packages/importer/cli.mjs --input <file.md|file.pdf|file.txt> --id <packId> \
 *        --title "标题" [--lang zh] [--out content/<id>] [--max-units 40] \
 *        [--no-placeholder] [--force] [--pages-per-chapter 3]
 *
 * 流程：读输入 → 切章切段（markdown.mjs / pdf.mjs）→ 生成
 *       content/<id>/00_pack.js（meta）+ 01_body.js（往 window.__PACK__.chapters push）
 *       → 用 validatePack 自检 → 打印统计与「下一步该补什么」。
 * 输出可被 validatePack 通过（0 error）；explain 为占位，属预期警告来源。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePack, loadKaTeX } from '../schema/validate.mjs';
import { parseMarkdown, EXPLAIN_PLACEHOLDER } from './markdown.mjs';
import { importPdf, PYTHON_NOT_FOUND } from './pdf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PACK_HEADER = '/* 由 packages/importer/cli.mjs 生成 · 原文层已就绪，教学层待补 */';

const USAGE = `用法：
  node packages/importer/cli.mjs --input <file.md|file.pdf|file.txt> --id <packId> --title "标题" \\
       [--lang zh|en] [--out content/<id>] [--max-units 40] [--no-placeholder] [--force]

参数：
  --input <path>          输入文件（.md/.markdown/.txt/.pdf）
  --id <packId>           读包 id（URL 安全，如 mypaper）
  --title "标题"          读包标题
  --lang <zh|en>          语言，默认 zh
  --out <dir>             输出目录，相对项目根；默认 content/<id>
  --max-units <n>         单章单元上限，超出自动续章；默认 40
  --no-placeholder        explain 留空（默认写占位文案）
  --force                 目标目录已有文件时允许覆盖
  --pages-per-chapter <n> PDF 无标题时每 n 页一章；默认 3`;

function fail(msg) {
  process.stderr.write('错误：' + msg + '\n');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { lang: 'zh', maxUnits: 40, placeholder: true, force: false, pagesPerChapter: 3 };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw) continue;
    if (raw === '-h' || raw === '--help') return { help: true };
    if (!raw.startsWith('--')) continue;
    let key = raw.slice(2);
    let value;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    const takeValue = () => {
      if (value !== undefined) return value;
      const next = argv[++i];
      if (next === undefined || String(next).startsWith('--')) fail('参数 --' + key + ' 缺少取值');
      return next;
    };
    switch (key) {
      case 'input': args.input = takeValue(); break;
      case 'id': args.id = takeValue(); break;
      case 'title': args.title = takeValue(); break;
      case 'lang': args.lang = takeValue(); break;
      case 'out': args.out = takeValue(); break;
      case 'max-units': args.maxUnits = Number(takeValue()); break;
      case 'pages-per-chapter': args.pagesPerChapter = Number(takeValue()); break;
      case 'no-placeholder': args.placeholder = false; value = undefined; break;
      case 'force': args.force = true; value = undefined; break;
      default: fail('未知参数 --' + key + '\n\n' + USAGE);
    }
  }
  return args;
}

// ------------------------------------------------------------ 生成 JS 源码

/** 单个字符串字面量：优先单引号；含 LaTeX 反斜杠/换行时用 String.raw；兜底 JSON */
function jsString(s) {
  const str = String(s == null ? '' : s);
  if (str === '') return "''";
  if (!/['\\\r\n]/.test(str)) return "'" + str + "'";
  const rawSafe = !str.includes('`') && !str.includes('${') && !/\\$/.test(str) && !str.includes('\r');
  if (rawSafe) return 'r`' + str + '`';
  return JSON.stringify(str).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function renderPackFile(pack) {
  const meta = JSON.stringify(pack.meta, null, 2).replace(/\n/g, '\n  ');
  return [
    PACK_HEADER,
    'window.PAPERS = window.PAPERS || [];',
    'window.__PACK__ = {',
    '  schema: ' + pack.schema + ',',
    '  meta: ' + meta + ',',
    '  chapters: []',
    '};',
    'window.PAPERS.push(window.__PACK__);',
    ''
  ].join('\n');
}

function renderBodyFile(pack) {
  const out = [PACK_HEADER, '(function () {', '  var r = String.raw;', '  var P = window.__PACK__;'];
  for (const ch of pack.chapters) {
    out.push('');
    out.push('  P.chapters.push({');
    out.push('    id: ' + jsString(ch.id) + ', num: ' + jsString(ch.num) + ',');
    out.push('    title: ' + jsString(ch.title) + ',');
    out.push('    paras: [');
    ch.paras.forEach((u, i) => {
      out.push('      { id: ' + jsString(u.id) + ', title: ' + jsString(u.title) + ', tags: ' + JSON.stringify(u.tags) + ',');
      out.push('        raw: ' + jsString(u.raw) + ',');
      out.push('        explain: ' + jsString(u.explain) + ' }' + (i === ch.paras.length - 1 ? '' : ','));
    });
    out.push('    ]');
    out.push('  });');
  }
  out.push('})();', '');
  return out.join('\n');
}

function writeUtf8(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { encoding: 'utf8' }); // 无 BOM
}

// ------------------------------------------------------------ 主流程

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }
  if (!args.input) fail('缺少 --input\n\n' + USAGE);
  if (!args.id) fail('缺少 --id\n\n' + USAGE);
  if (!args.title) fail('缺少 --title\n\n' + USAGE);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(args.id)) fail('--id 不合规（应 URL 安全，如 mypaper-2024）: ' + args.id);
  if (!Number.isFinite(args.maxUnits) || args.maxUnits < 1) fail('--max-units 应为正整数');
  if (!['zh', 'en'].includes(args.lang)) fail('--lang 只支持 zh / en');

  const input = path.resolve(process.cwd(), args.input);
  if (!fs.existsSync(input)) fail('输入文件不存在：' + input);
  const ext = path.extname(input).toLowerCase();
  const sourceName = path.basename(input);
  const placeholder = args.placeholder;
  const opts = { placeholder, maxUnits: Math.floor(args.maxUnits), pagesPerChapter: args.pagesPerChapter };

  let chapters = [];
  let warnings = [];
  let pdfMeta = null;
  let kind = '';

  if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    kind = ext === '.txt' ? '纯文本' : 'Markdown';
    const md = fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '');
    const parsed = parseMarkdown(md, { ...opts, fallbackTitle: args.title });
    chapters = parsed.chapters;
    warnings = parsed.warnings;
  } else if (ext === '.pdf') {
    kind = 'PDF';
    const parsed = importPdf(input, opts);
    chapters = parsed.chapters;
    warnings = parsed.warnings;
    pdfMeta = parsed.meta;
  } else {
    fail('不支持的输入类型：' + (ext || '(无扩展名)') + '（支持 .md/.markdown/.txt/.pdf）');
  }

  if (!chapters.length) fail('没有切出任何章节/单元，请检查输入文件是否为空');

  const meta = {
    id: args.id,
    title: args.title,
    lang: args.lang,
    source: sourceName,
    tags: ['导入'],
    version: '0.1.0'
  };
  if (pdfMeta && pdfMeta.author && !String(pdfMeta.author).includes('未')) meta.authors = [String(pdfMeta.author)];
  if (ext === '.pdf') meta.sourceKind = 'pdf';

  const pack = { schema: 1, meta, chapters };

  const outDir = path.resolve(ROOT, args.out || path.join('content', args.id));
  const packFile = path.join(outDir, '00_pack.js');
  const bodyFile = path.join(outDir, '01_body.js');
  if (!args.force && fs.existsSync(outDir)) {
    const existing = fs.readdirSync(outDir).filter((f) => f.endsWith('.js'));
    if (existing.length) fail('目标目录已有读包文件：' + outDir + '（加 --force 覆盖）');
  }

  writeUtf8(packFile, renderPackFile(pack));
  writeUtf8(bodyFile, renderBodyFile(pack));

  // ---- 自检：KaTeX 加载失败也照跑结构校验
  const katex = loadKaTeX();
  const result = validatePack(pack, { katex: katex === false ? false : katex });
  const { errors, warnings: vWarnings, stats } = result;
  const allWarnings = [...warnings, ...vWarnings];
  const placeholderCount = chapters.reduce(
    (n, c) => n + c.paras.filter((p) => p.explain === EXPLAIN_PLACEHOLDER).length,
    0
  );

  const lines = [];
  lines.push('读包导入完成：' + args.id + '（' + kind + '）');
  lines.push('  输入：' + input);
  lines.push('  输出：' + outDir);
  if (ext === '.pdf' && pdfMeta && pdfMeta.title) lines.push('  PDF 标题：' + pdfMeta.title);
  lines.push('');
  lines.push(
    '统计：章 ' + stats.chapters +
    ' · 单元 ' + stats.units +
    ' · 行内公式 ' + stats.inlineMath +
    ' · 独立公式 ' + stats.displayMath +
    ' · 警告 ' + allWarnings.length +
    ' · 错误 ' + errors.length
  );
  if (!katex) lines.push('  注：KaTeX 未加载，本次只做了结构校验（公式未被严格渲染）。');

  if (errors.length) {
    lines.push('');
    lines.push('校验错误（必须修）：');
    errors.slice(0, 30).forEach((e) => lines.push('  ✗ ' + e));
    if (errors.length > 30) lines.push('  … 还有 ' + (errors.length - 30) + ' 条');
  }
  if (allWarnings.length) {
    lines.push('');
    lines.push('警告（可接受，建议逐步处理）：');
    allWarnings.slice(0, 10).forEach((w) => lines.push('  ! ' + w));
    if (allWarnings.length > 10) lines.push('  … 还有 ' + (allWarnings.length - 10) + ' 条');
  }

  const relOut = path.relative(ROOT, outDir);
  const shownOut = relOut && !relOut.startsWith('..') ? relOut.replace(/\\/g, '/') : outDir;
  lines.push('');
  lines.push('下一步该补什么：');
  if (placeholderCount) {
    lines.push('  1. 补写 explain：' + placeholderCount + ' 个单元仍是占位（改 ' + shownOut + '/01_body.js）');
  } else {
    lines.push('  1. 补写 explain：当前无占位单元（或使用了 --no-placeholder，需补空 explain）');
  }
  lines.push('  2. 给核心单元补 gloss / quiz / faq / legend（见 docs/CONTENT_FORMAT.md）');
  lines.push('  3. 校验与构建：npm run validate && npm run build');
  lines.push('  4. 打开 app/index.html，检查篇目 ' + args.id + ' 的排版与公式');
  lines.push('  5. 补 meta.authors / year / venue / url / abstract 等元数据');

  process.stdout.write(lines.join('\n') + '\n');

  if (errors.length) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  const msg = String((err && err.message) || err);
  if (msg === PYTHON_NOT_FOUND) fail(msg);
  process.stderr.write('错误：' + msg + '\n');
  process.exitCode = 1;
}
