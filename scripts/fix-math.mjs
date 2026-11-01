#!/usr/bin/env node
/**
 * 把读包里 KaTeX 渲染不了的常见 LaTeX 写法改成能渲染的等价形式。
 *
 *   npm run fix                 # 修 content/ 下所有读包
 *   npm run fix -- content/foo  # 只修一个读包（或单个文件）
 *   npm run fix -- content/foo --dry   # 只报告不改
 *
 * 只做**保语义**的机械替换（括号配对解析，不碰中文正文）：
 *   \dots -> \ldots            \boxed{X} -> X            \fbox{X} -> X
 *   \colorbox{c}{X} -> X       \tag{n} -> (删)           \operatorname{X} -> \mathrm{X}
 *   \mathop{X} -> \mathrm{X}   \bm{X}/\boldsymbol{X} -> \mathbf{X}
 *   \underbrace{X}_{Y} -> (X)_{Y}                       \overbrace{X}^{Y} -> (X)^{Y}
 *   \substack{X} -> X          align 环境 -> aligned
 *
 * 改不动的（比如把中文放进 \text{}、\overset）会留在报告里，需要手改。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const targets = args.filter(a => !a.startsWith('--'));

/** 从 start（指向 '{'）开始找配对的 '}'，返回 {body, end}（end 指向 '}' 之后） */
function readGroup(s, start) {
  if (s[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { body: s.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** 通用：把 \cmd{...} 换成 mapper(body)（支持前导空白与可选参数） */
function rewriteCmd(src, cmd, mapper) {
  let out = '', i = 0, changed = 0;
  const needle = '\\' + cmd;
  while (i < src.length) {
    const at = src.indexOf(needle, i);
    if (at < 0) { out += src.slice(i); break; }
    out += src.slice(i, at);
    let j = at + needle.length;
    if (/[A-Za-z]/.test(src[j] || '')) { out += needle; i = j; continue; }  // \boxedx 不是 \boxed
    while (src[j] === ' ') j++;
    // \colorbox{c}{X}：先吃掉第一个参数
    let extra = '';
    if (cmd === 'colorbox') {
      const c = readGroup(src, j);
      if (!c) { out += needle; i = at + needle.length; continue; }
      j = c.end;
      while (src[j] === ' ') j++;
      extra = c.body;
    }
    const g = readGroup(src, j);
    if (!g) { out += needle; i = at + needle.length; continue; }
    out += mapper(g.body, extra);
    i = g.end;
    changed++;
  }
  return { out, changed };
}

/** 按规则清洗一段公式源码 */
export function fixMathText(src) {
  const report = [];
  let s = src;
  const before = s;

  // \\dots -> \\ldots（不需要括号解析）
  const nDots = (s.match(/\\dots\b/g) || []).length;
  if (nDots) { s = s.replace(/\\dots\b/g, '\\ldots'); report.push(`\\dots -> \\ldots (${nDots})`); }

  const table = [
    ['boxed', b => b],
    ['fbox', b => b],
    ['colorbox', b => b],
    ['tag', () => ''],
    ['operatorname', b => `\\mathrm{${b}}`],
    ['mathop', b => `\\mathrm{${b}}`],
    ['bm', b => `\\mathbf{${b}}`],
    ['boldsymbol', b => `\\mathbf{${b}}`],
    ['substack', b => b.replace(/\\\\/g, ',\\ ')],
    ['underbrace', b => `(${b})`],
    ['overbrace', b => `(${b})`]
  ];
  for (const [cmd, mapper] of table) {
    const r = rewriteCmd(s, cmd, mapper);
    if (r.changed) { s = r.out; report.push(`\\${cmd}{…} (${r.changed})`); }
  }

  // \underbrace{X}_{Y} -> (X)_{Y} / \overbrace{X}^{Y} -> (X)^{Y} 已由上面变成 (X)_{Y}
  const envBefore = s;
  s = s.replace(/\\begin\{align\}/g, '\\begin{aligned}').replace(/\\end\{align\}/g, '\\end{aligned}');
  if (s !== envBefore) report.push('align 环境 -> aligned');

  return { text: s, changed: s !== before, report };
}

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.js'))
    .map(d => path.join(target, d.name));
}

function main() {
  const dirs = targets.length
    ? targets.map(t => path.resolve(ROOT, t))
    : fs.readdirSync(path.join(ROOT, 'content'), { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
        .map(d => path.join(ROOT, 'content', d.name));

  if (!dirs.length) {
    console.log('没有可修的读包。用 npm run new / npm run import 先建一个。');
    return;
  }

  let totalFiles = 0, totalChanged = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) { console.error(`✗ 路径不存在：${path.relative(ROOT, dir)}`); continue; }
    for (const file of collectFiles(dir)) {
      const src = fs.readFileSync(file, 'utf8');
      const { text, changed, report } = fixMathText(src);
      totalFiles++;
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (!changed) { console.log(`  = ${rel}（无需修改）`); continue; }
      totalChanged++;
      console.log(`  ✎ ${rel}`);
      report.forEach(r => console.log(`      · ${r}`));
      if (!DRY) fs.writeFileSync(file, text, 'utf8');
    }
  }
  console.log(`\n${DRY ? '（--dry：未写入）' : '完成'}：检查 ${totalFiles} 个文件，修改 ${totalChanged} 个`);
  if (totalChanged && !DRY) {
    console.log('下一步：npm run build（剩余改不动的会继续报错，需要手改）');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
