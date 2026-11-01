#!/usr/bin/env node
/**
 * 构建：content/<pack>/**.js  ->  app/packs.js
 *
 * 为什么要有这一步：
 *   - 浏览器在 file:// 下不能 fetch JSON，读包必须以 JS 形式随页面加载；
 *   - 一篇论文拆成多个源文件便于维护，但页面只需一个 <script>；
 *   - 构建顺带做结构校验（CI 与 npm run build 都能挡住坏内容）。
 *
 * 用法：
 *   node scripts/build.mjs            构建并校验
 *   node scripts/build.mjs --check    只校验，不写文件（CI 用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePacks } from '../packages/schema/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const OUT = path.join(ROOT, 'app', 'packs.js');
const CHECK_ONLY = process.argv.includes('--check');

const HEAD = (buildTime, packCount) => `/*
 * 自动生成文件 —— 不要手改。
 * 源文件：content/<pack>/*.js   生成器：scripts/build.mjs
 * 生成时间：${buildTime}
 * 读包数：${packCount}
 */
window.PAPERS = [];
`;

function listPackDirs() {
  if (!fs.existsSync(CONTENT)) return [];
  return fs.readdirSync(CONTENT, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort();
}

function listPackFiles(packId) {
  const dir = path.join(CONTENT, packId);
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort()                       // 00_pack.js 必须在最前 -> 命名约定
    .map(f => path.join(dir, f));
}

/** 在 Node 里执行浏览器侧的 pack 代码，拿到 window.PAPERS */
export function loadPacksInSandbox(code) {
  const sandboxWindow = { PAPERS: [] };
  const fn = new Function('window', '"use strict";\n' + code + '\n;return window.PAPERS;');
  const packs = fn(sandboxWindow);
  return Array.isArray(packs) ? packs : [];
}

function main() {
  const packIds = listPackDirs();
  if (!packIds.length) {
    // 框架本身不带读包：空仓库也要能构建、能起服务，前端会显示引导页。
    console.warn('! content/ 下没有读包（只有 _template/）。这不是错误。');
    console.warn('  用 npm run new 或 npm run import 建第一个读包，然后重新构建。');
  }

  const chunks = [];
  const manifest = [];
  for (const id of packIds) {
    const files = listPackFiles(id);
    if (!files.length) continue;
    const parts = files.map(f => {
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      return `/* ---- ${rel} ---- */\n` + fs.readFileSync(f, 'utf8').trim() + '\n';
    });
    chunks.push(`/* ===== pack: ${id} ===== */\n` + parts.join('\n'));
    manifest.push({ id, files: files.length });
  }

  // 正文与时间戳分开拼：只要正文没变就沿用旧时间戳，
  // 这样 CI 的「生成物与源一致」检查不会因为每次构建的时间不同而误报。
  const body = chunks.join('\n') + '\nwindow.__PACKS_BUILT__ = true;\n';
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const prevBody = prev ? prev.slice(prev.indexOf('window.PAPERS = [];') + 'window.PAPERS = [];'.length) : null;
  const same = prevBody !== null && prevBody.trim() === body.trim();
  const prevStamp = (prev.match(/生成时间：([^\n]*)/) || [])[1] || '';
  const stamp = same && prevStamp ? prevStamp : new Date().toISOString();
  const code = HEAD(stamp, manifest.length) + body;

  // ---- 先在沙箱里跑一遍，确认代码可执行且结构合法 ----
  let packs;
  try {
    packs = loadPacksInSandbox(code);
  } catch (e) {
    console.error('✗ 读包代码执行失败：' + e.message);
    console.error('  常见原因：缺少 String.raw、pack 文件里抛异常、window.__PACK__ 未定义');
    process.exit(1);
  }

  const { errors, warnings, perPack, stats } = validatePacks(packs);

  console.log('读包：' + manifest.map(m => `${m.id}(${m.files} 文件)`).join('、'));
  for (const r of perPack) {
    const s = r.stats;
    console.log(`  ${r.id}: 章 ${s.chapters} · 单元 ${s.units} · 自测 ${s.quizzes} · 注解 ${s.glosses} · 公式 ${s.inlineMath + s.displayMath}`);
  }
  console.log(`合计：${stats.chapters} 章 / ${stats.units} 单元 / ${stats.quizzes} 题 / ${stats.inlineMath + stats.displayMath} 公式`);

  if (warnings.length) {
    console.log(`\n提醒 ${warnings.length} 条：`);
    warnings.slice(0, 20).forEach(w => console.log('  - ' + w));
    if (warnings.length > 20) console.log(`  …还有 ${warnings.length - 20} 条`);
  }
  if (errors.length) {
    console.error(`\n✗ 错误 ${errors.length} 条：`);
    errors.slice(0, 40).forEach(e => console.error('  ✗ ' + e));
    process.exit(1);
  }

  if (CHECK_ONLY) {
    console.log('\n✓ --check：内容合法（未写文件）');
    return;
  }

  const prev2 = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const identical = prev2 === code;
  if (!CHECK_ONLY && !identical) fs.writeFileSync(OUT, code, 'utf8');
  const kb = (Buffer.byteLength(code) / 1024).toFixed(1);
  console.log(`\n✓ ${identical ? '无变化' : '已更新'} app/packs.js（${kb} KB）`);
  if (!identical) console.log('  提示：浏览器刷新即可看到新内容');
}

main();
