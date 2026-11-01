/**
 * importer.test.mjs — 读包导入器测试（node:test，零依赖）。
 *
 * 覆盖：Markdown 切章切段 / 语法清洗 / CLI 端到端（生成文件 + validatePack 0 error）
 *       以及 PDF 冒烟（有 PyMuPDF 时跑，没有则跳过）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseMarkdown, EXPLAIN_PLACEHOLDER } from '../packages/importer/markdown.mjs';
import { validatePack, loadKaTeX } from '../packages/schema/validate.mjs';
import { findPython, extractPdf, importPdf } from '../packages/importer/pdf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURE_MD = path.join(HERE, 'fixtures', 'sample.md');
const FIXTURE_PDF = path.join(HERE, 'fixtures', 'sample.pdf');

// 本仓库的 katex.min.js 是 ESM，Node 下 require 会失败 → loadKaTeX() 返回 false，
// 此时校验器自动退化为结构校验，这也是 cli.mjs 必须容忍的场景。
const KATEX = loadKaTeX() || false;

function makePack(chapters, id = 'sample') {
  return {
    schema: 1,
    meta: { id, title: '示例读包', lang: 'zh', source: 'sample.md', tags: ['导入'], version: '0.1.0' },
    chapters
  };
}

function fixtureMarkdown() {
  return fs.readFileSync(FIXTURE_MD, 'utf8');
}

test('markdown：2 章 9 单元，公式计数正确，validatePack 0 error', () => {
  const { chapters } = parseMarkdown(fixtureMarkdown(), { maxUnits: 40 });

  assert.equal(chapters.length, 2, '应切出 2 章（# 一级标题）');
  assert.deepEqual(chapters.map((c) => c.id), ['c1', 'c2']);

  const units = chapters.flatMap((c) => c.paras);
  assert.equal(units.length, 9, '应切出 9 个单元');
  for (const u of units) {
    assert.match(u.id, /^c\d+p\d+$/);
    assert.ok(u.title.length > 0, 'unit.title 不能为空');
    assert.ok(u.raw.length > 0, 'unit.raw 不能为空');
    assert.equal(u.explain, EXPLAIN_PLACEHOLDER);
    assert.deepEqual(u.tags, ['导入']);
  }

  const { errors, stats } = validatePack(makePack(chapters), { katex: KATEX });
  assert.deepEqual(errors, [], '结构校验必须 0 error');
  assert.equal(stats.chapters, 2);
  assert.equal(stats.units, 9);
  assert.equal(stats.inlineMath, 5, '行内公式应保留 5 个');
  assert.equal(stats.displayMath, 1, '独立公式应保留 1 个');
});

test('markdown：剥掉 Markdown 语法，保留公式与代码块', () => {
  const { chapters } = parseMarkdown(fixtureMarkdown(), { maxUnits: 40 });
  const all = chapters.flatMap((c) => c.paras.map((u) => u.raw)).join('\n\n');

  assert.ok(!all.includes('**'), '粗体标记应被剥除');
  assert.ok(!all.includes('](http'), '链接语法应被剥除');
  assert.ok(all.includes('鲁棒最优传输论文'), '链接文字应保留');
  assert.ok(all.includes('示意图'), '图片 alt 文字应保留');

  assert.ok(all.includes('$W(P)=\\sum_{i,j} P_{ij}c_{ij}$'), '行内公式应原样保留');
  assert.ok(all.includes('$$'), '独立公式 $$ 应保留');
  assert.ok(all.includes('\\min_{P \\in \\Pi(a,b)}'), '独立公式内容应保留');

  assert.ok(all.includes('def cost(P, C):'), '代码块内容应保留');
  assert.ok(all.includes('\n'), '代码块应保留换行');
  assert.ok(!all.includes('```'), '代码围栏应被剥除');

  assert.ok(all.includes('不确定性来自支持点的位置扰动'), '引用块文字应保留');
  assert.ok(!/[^\n]>\s/.test(all), '引用标记 > 应被剥除');

  // 单元 title 取首句前 30 字，且不残留公式定界符
  const first = chapters[0].paras[0];
  assert.ok(first.title.length <= 31);
  assert.ok(!first.title.includes('$'));
});

test('markdown：--no-placeholder 时 explain 为空（警告而非错误）', () => {
  const { chapters } = parseMarkdown(fixtureMarkdown(), { maxUnits: 40, placeholder: false });
  assert.ok(chapters.every((c) => c.paras.every((u) => u.explain === '')));
  const { errors, warnings } = validatePack(makePack(chapters), { katex: KATEX });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('explain 为空')));
});

test('cli：生成 00_pack.js + 01_body.js，可执行且 validatePack 0 error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-import-'));
  const out = path.join(tmp, 'sample');
  const r = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'packages', 'importer', 'cli.mjs'),
      '--input', FIXTURE_MD,
      '--id', 'sample',
      '--title', '示例读包',
      '--out', out,
      '--max-units', '40'
    ],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, 'cli 应以 0 退出，实际 stderr：' + r.stderr);
  assert.match(r.stdout, /统计：章 2 · 单元 9/);
  assert.match(r.stdout, /错误 0/);
  assert.match(r.stdout, /下一步该补什么/);

  const packFile = path.join(out, '00_pack.js');
  const bodyFile = path.join(out, '01_body.js');
  assert.ok(fs.existsSync(packFile), '应生成 00_pack.js');
  assert.ok(fs.existsSync(bodyFile), '应生成 01_body.js');

  for (const f of [packFile, bodyFile]) {
    const buf = fs.readFileSync(f);
    assert.notEqual(buf[0], 0xef, '文件必须是 UTF-8 无 BOM');
  }

  // 在 vm 里模拟浏览器执行：window.PAPERS / window.__PACK__
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  for (const f of [packFile, bodyFile]) {
    vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: path.basename(f) });
  }
  const pack = sandbox.window.__PACK__;
  assert.ok(pack, '应定义 window.__PACK__');
  assert.equal(pack.schema, 1);
  assert.equal(pack.meta.id, 'sample');
  assert.equal(pack.chapters.length, 2);
  assert.equal(sandbox.window.PAPERS[0], pack);

  const { errors } = validatePack(pack, { katex: KATEX });
  assert.deepEqual(errors, [], '生成的读包必须能被 validatePack 通过');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('cli：--no-placeholder 生成空 explain 仍可校验', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-import-'));
  const out = path.join(tmp, 'empty-explain');
  const r = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'packages', 'importer', 'cli.mjs'),
      '--input', FIXTURE_MD,
      '--id', 'sample-noexplain',
      '--title', '示例读包',
      '--out', out,
      '--no-placeholder'
    ],
    { encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /警告 \d+/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('pdf：抽取 + 组装冒烟（无 PyMuPDF 时跳过）', (t) => {
  const python = findPython();
  if (!python) {
    t.skip('未找到 PyMuPDF 解释器：跳过 PDF 冒烟测试');
    return;
  }
  if (!fs.existsSync(FIXTURE_PDF)) {
    t.skip('缺少 tests/fixtures/sample.pdf：跳过 PDF 冒烟测试');
    return;
  }

  const { pages, meta } = extractPdf(FIXTURE_PDF);
  assert.ok(pages.length >= 3, 'fixture PDF 至少 3 页');
  assert.ok(pages[0].text.length > 20, '第一页应抽到正文');
  // 页眉在每页重复，应被去掉
  assert.ok(!pages.some((p) => p.text.includes('Robust OT Reading Notes')), '跨页重复页眉应被删除');
  // 行尾断词应合并
  const joined = pages.map((p) => p.text).join('\n');
  assert.ok(!/unsuper-\s/.test(joined), '行尾断词应合并为 unsupervised');
  assert.ok(typeof meta === 'object');

  const { chapters } = importPdf(FIXTURE_PDF, { maxUnits: 40 });
  assert.ok(chapters.length >= 2, '应识别出至少 2 个一级标题章');
  const { errors, stats } = validatePack(makePack(chapters, 'sample-pdf'), { katex: KATEX });
  assert.deepEqual(errors, [], 'PDF 读包必须 0 error');
  assert.ok(stats.units >= 3);
});
