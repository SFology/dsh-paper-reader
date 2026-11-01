/**
 * markdown.mjs — Markdown/纯文本 → 读包 chapters/units（只保证「原文层」）。
 *
 * 切分规则（规范见 docs/CONTENT_FORMAT.md 与 docs 末尾「导入器实现说明」）：
 *   #    → 章
 *   ##   → 子节：当前章未达 --max-units 时并入（当节标记），否则自成章
 *   ###  → 子节标记（没有当前章时自成章）
 *   连续非空行 → 一个单元；超过 ~1200 字符时按句子边界再切
 *   $...$ / $$...$$ 原样保留；代码块保留内容、不参与公式解析
 *   其余 Markdown 语法（粗体/斜体/行内代码/链接/图片/引用/列表符号）剥除
 *
 * cli.mjs（Markdown/文本）与 pdf.mjs（PDF 段落）共用 finalizeChapters。
 */
import { tokenizeMath, stripMath } from '../schema/validate.mjs';

export const UNIT_MAX_CHARS = 1200;
export const TITLE_MAX_CHARS = 30;
export const IMPORT_TAG = '导入';
export const EXPLAIN_PLACEHOLDER = '（待补写：本单元的教学讲解）';

const MATH_OPEN = '\uE000';
const MATH_CLOSE = '\uE001';

// ---------------------------------------------------------------- 文本工具

function isCJK(ch) {
  return !!ch && /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(ch);
}

/** 合并两行：行尾 '-' 断词直接拼接；中文相邻不加空格；否则加空格 */
function joinPair(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (/-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  if (isCJK(a.slice(-1)) || isCJK(b.charAt(0))) return a + b;
  return a + ' ' + b;
}

/** 把若干物理行合并成一段（保留行尾断词语义） */
export function joinLines(lines) {
  let out = '';
  for (const raw of lines || []) {
    const line = String(raw == null ? '' : raw).trim();
    if (!line) continue;
    out = joinPair(out, line);
  }
  return out;
}

function cleanTextToken(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // 图片 → alt 文字
  t = t.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // 链接 → 文字
  t = t.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1'); // 引用式链接
  t = t.replace(/`{1,3}([^`]*)`{1,3}/g, '$1'); // 行内代码
  t = t.replace(/(\*\*|__)([\s\S]+?)\1/g, '$2'); // 粗体
  t = t.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, '$1'); // 斜体
  t = t.replace(/(?<![\w_])_(?!\s)([^_\n]+?)_(?![\w_])/g, '$1'); // _斜体_
  t = t.replace(/~~([\s\S]+?)~~/g, '$1'); // 删除线
  t = t.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1'); // 反斜杠转义
  t = t.replace(/<\/?[A-Za-z][^>]*>/g, ' '); // HTML 标签
  return t;
}

/** 剥掉 Markdown 行内语法，但保护数学公式：$…$ / $$…$$ 原样保留 */
export function cleanInline(text) {
  const toks = tokenizeMath(String(text == null ? '' : text));
  const out = toks
    .map((tok) => {
      if (tok.t === 'm') return '$' + tok.v + '$';
      if (tok.t === 'D') return '$$' + tok.v + '$$';
      return cleanTextToken(tok.v);
    })
    .join('');
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/** 把文本里的公式替换成私用区占位符（切句/切段时保持公式原子性） */
function protectMath(text) {
  const vals = [];
  const s = tokenizeMath(String(text == null ? '' : text))
    .map((tok) => {
      if (tok.t === 'text') return tok.v;
      vals.push(tok);
      return MATH_OPEN + (vals.length - 1) + MATH_CLOSE;
    })
    .join('');
  return { s, vals };
}

function restoreMath(s, vals) {
  return String(s).replace(/\uE000(\d+)\uE001/g, (_, i) => {
    const tok = vals[Number(i)];
    if (!tok) return '';
    return tok.t === 'm' ? '$' + tok.v + '$' : '$$' + tok.v + '$$';
  });
}

function splitProtectedSentences(s) {
  const out = [];
  let start = 0;
  const re = /[。！？!?；;]+[”’"'）)\]]*|…+|\.(?=\s+[A-Z(“"'])/g;
  let m;
  while ((m = re.exec(s))) {
    const end = m.index + m[0].length;
    out.push(s.slice(start, end));
    start = end;
  }
  if (start < s.length) out.push(s.slice(start));
  return out.filter((x) => x.trim());
}

/** 把占位符文本按句末标点切成句子（公式仍然原子） */
export function splitSentences(text) {
  const { s, vals } = protectMath(text);
  return splitProtectedSentences(s)
    .map((x) => restoreMath(x, vals).trim())
    .filter(Boolean);
}

/** 保证硬切点不落在公式占位符内部 */
function safeCut(s, cut) {
  let i = cut;
  while (i > 0 && s[i - 1] !== MATH_OPEN && s.slice(0, i).lastIndexOf(MATH_OPEN) > s.slice(0, i).lastIndexOf(MATH_CLOSE)) {
    i--;
  }
  return i > 0 ? i : cut;
}

/**
 * 把过长的一段按句子边界切成不超过 maxChars 的若干块（公式不会被切断）。
 * @returns {string[]}
 */
export function splitLongText(text, maxChars = UNIT_MAX_CHARS) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return [];
  const limit = Math.max(80, Number(maxChars) || UNIT_MAX_CHARS);
  if (t.length <= limit) return [t];

  const { s, vals } = protectMath(t);
  const segs = splitProtectedSentences(s);
  const out = [];
  const push = (piece) => {
    const x = restoreMath(piece, vals).trim();
    if (x) out.push(x);
  };

  let cur = '';
  for (const seg of segs) {
    if (cur && cur.length + 1 + seg.length > limit) {
      push(cur);
      cur = '';
    }
    if (seg.length > limit) {
      let rest = seg;
      while (rest.length > limit) {
        let cut = rest.lastIndexOf(' ', limit);
        if (cut < Math.floor(limit * 0.4)) cut = rest.lastIndexOf('，', limit);
        if (cut < Math.floor(limit * 0.4)) cut = rest.lastIndexOf(',', limit);
        if (cut < Math.floor(limit * 0.4)) cut = limit;
        cut = safeCut(rest, cut);
        if (cut <= 0) cut = limit;
        push(rest.slice(0, cut));
        rest = rest.slice(cut).trim();
      }
      if (rest) cur = rest;
    } else {
      cur = cur ? cur + ' ' + seg : seg;
    }
  }
  push(cur);
  return out;
}

// ---------------------------------------------------------------- 块解析

function stripLineMarkers(line) {
  let t = String(line == null ? '' : line);
  // 引用块前缀（可嵌套）
  t = t.replace(/^\s*>\s?/, '').replace(/^\s*>\s?/, '');
  // 任务列表 / 列表符号
  t = t.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '');
  t = t.replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, '');
  return t;
}

function cleanHeading(s) {
  return cleanInline(String(s || '').replace(/\s+#+\s*$/, '')).trim();
}

/**
 * Markdown → 块序列。
 * 块类型：{kind:'heading', level} / {kind:'text'} / {kind:'math'} / {kind:'code'}
 */
export function parseMarkdownBlocks(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    const joined = joinLines(para);
    para = [];
    const text = cleanInline(joined);
    if (text) blocks.push({ kind: 'text', text });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    // ---- 围栏代码块：剥掉 ``` 标记，保留内容（缩进/换行不丢）
    const fence = /^(`{3,}|~{3,})\s*[A-Za-z0-9_+.#-]*\s*$/.exec(t);
    if (fence) {
      flushPara();
      const marker = fence[1][0];
      const body = [];
      i++;
      while (i < lines.length) {
        if (new RegExp('^\\s*' + marker + '{3,}\\s*$').test(lines[i])) break;
        body.push(lines[i]);
        i++;
      }
      const code = body.join('\n').replace(/\s+$/, '');
      if (code.trim()) blocks.push({ kind: 'code', text: code });
      continue;
    }

    // ---- 独立公式块 $$...$$
    if (t.startsWith('$$')) {
      const single = t.indexOf('$$', 2);
      if (single >= 0) {
        // 单行 $$…$$：跟在段落里就并入段落，否则独立成块
        if (para.length) para.push(t);
        else blocks.push({ kind: 'math', text: t });
        continue;
      }
      flushPara();
      const body = [t];
      i++;
      while (i < lines.length) {
        body.push(lines[i].trim());
        if (lines[i].indexOf('$$') >= 0) break;
        i++;
      }
      blocks.push({ kind: 'math', text: body.join('\n').trim() });
      continue;
    }

    // ---- 标题
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(t);
    if (h) {
      flushPara();
      blocks.push({ kind: 'heading', level: h[1].length, text: cleanHeading(h[2]) });
      continue;
    }

    // ---- 分隔线
    if (/^([-*_])(?:\s*\1){2,}$/.test(t)) {
      flushPara();
      continue;
    }

    // ---- 空行 = 段落结束
    if (!t) {
      flushPara();
      continue;
    }

    // ---- 普通行（保留原始字符，行内清洗留到 flushPara 统一做）
    para.push(stripLineMarkers(line));
  }
  flushPara();
  return blocks;
}

// ---------------------------------------------------------------- 块 → 章 → 单元

/** 章节内子节：能并则并（当前章单元数未达上限），否则成章 */
function blocksToRawChapters(blocks, opts = {}) {
  const fallbackTitle = String(opts.fallbackTitle || '正文');
  const maxUnits = Math.max(1, Number(opts.maxUnits) || 40);
  const hasH1 = blocks.some((b) => b.kind === 'heading' && b.level === 1);
  const chapters = [];
  let cur = null;

  const startChapter = (title) => {
    cur = { title: String(title || fallbackTitle).trim() || fallbackTitle, paras: [] };
    chapters.push(cur);
    return cur;
  };

  for (const b of blocks) {
    if (b.kind === 'heading') {
      if (b.level === 1) {
        startChapter(b.text);
      } else if (b.level === 2) {
        if (cur && cur.paras.length < maxUnits) cur.section = b.text;
        else startChapter(b.text);
      } else {
        if (cur) cur.section = b.text;
        else startChapter(b.text);
      }
      continue;
    }
    if (!cur) startChapter(hasH1 ? '前言' : fallbackTitle);
    cur.paras.push({ ...b, section: cur.section || '' });
  }
  return chapters;
}

function firstSentence(plain) {
  const s = String(plain || '').trim();
  if (!s) return '';
  let end = -1;
  for (const p of ['。', '！', '？', '!', '?', '；', ';', '…']) {
    const i = s.indexOf(p);
    if (i >= 0 && (end < 0 || i < end)) end = i;
  }
  const dot = /\.\s/.exec(s);
  if (dot && (end < 0 || dot.index < end)) end = dot.index;
  return (end >= 0 ? s.slice(0, end) : s).trim();
}

function unitTitle(text, ctx, section) {
  const plain = stripMath(text, { squash: false }).replace(/\s+/g, ' ').trim();
  let title = firstSentence(plain);
  title = title.replace(/^[\s·•\-–—*#]+/, '').replace(/\s+/g, ' ').trim();
  if (title.length > TITLE_MAX_CHARS) title = title.slice(0, TITLE_MAX_CHARS) + '…';
  if (title.length < 2) title = String(section || '').trim();
  if (!title) title = '第 ' + (++ctx.text) + ' 段';
  return title;
}

function blockToUnits(block, ctx, opts) {
  const section = String(block.section || '').trim();
  const kind = block.kind || 'text';

  if (kind === 'math') {
    return { units: [{ raw: String(block.text || '').trim(), title: section || '公式 ' + (++ctx.math) }] };
  }
  if (kind === 'code') {
    const raw = String(block.text || '').trim();
    if (!raw) return { units: [] };
    return { units: [{ raw, title: section || '代码 ' + (++ctx.code) }] };
  }

  const chunks = splitLongText(block.text, opts.unitMaxChars || UNIT_MAX_CHARS);
  const units = chunks.map((raw) => ({ raw, title: unitTitle(raw, ctx, section) }));
  return { units };
}

/**
 * 原始章（若干块）→ 规范章节：切长段、补 id/num/title/explain/tags、超限拆续章。
 * @param {Array<{title: string, paras: Array<{kind: string, text: string, section?: string}>}>} rawChapters
 * @param {{placeholder?: boolean, maxUnits?: number, unitMaxChars?: number}} [opts]
 * @returns {{chapters: object[], warnings: string[]}}
 */
export function finalizeChapters(rawChapters, opts = {}) {
  const placeholder = opts.placeholder !== false;
  const maxUnits = Math.max(1, Number(opts.maxUnits) || 40);
  const warnings = [];
  const flat = []; // {title, units:[{raw,title}]}

  for (const rc of rawChapters || []) {
    const ctx = { math: 0, code: 0, text: 0 };
    const units = [];
    for (const block of rc.paras || []) {
      units.push(...blockToUnits(block, ctx, opts).units);
    }
    if (!units.length) continue;
    const baseTitle = String(rc.title || '正文').trim() || '正文';
    for (let i = 0; i < units.length; i += maxUnits) {
      const chunk = units.slice(i, i + maxUnits);
      flat.push({ title: i === 0 ? baseTitle : baseTitle + '（续）', units: chunk });
    }
  }

  if (flat.length > (rawChapters || []).length) {
    warnings.push(`按 --max-units=${maxUnits} 拆分章节：${(rawChapters || []).length} → ${flat.length} 章`);
  }

  const chapters = flat.map((ch, ci) => {
    const n = ci + 1;
    return {
      id: 'c' + n,
      num: String(n),
      title: ch.title,
      paras: ch.units.map((u, ui) => ({
        id: 'c' + n + 'p' + (ui + 1),
        title: u.title,
        raw: u.raw,
        explain: placeholder ? EXPLAIN_PLACEHOLDER : '',
        tags: [IMPORT_TAG]
      }))
    };
  });

  return { chapters, warnings };
}

/**
 * Markdown/纯文本 → 规范章节。
 * @param {string} md
 * @param {{placeholder?: boolean, maxUnits?: number, unitMaxChars?: number, fallbackTitle?: string}} [opts]
 */
export function parseMarkdown(md, opts = {}) {
  const blocks = parseMarkdownBlocks(md);
  const rawChapters = blocksToRawChapters(blocks, opts);
  return finalizeChapters(rawChapters, opts);
}

/** 纯文本（PDF 段落）→ 规范章节：每个非空段落是一个块 */
export function parsePlainText(text, opts = {}) {
  const blocks = String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((s) => joinLines(s.split('\n')))
    .filter(Boolean)
    .map((t) => ({ kind: 'text', text: t, section: '' }));
  return finalizeChapters([{ title: opts.fallbackTitle || '正文', paras: blocks }], opts);
}
