/**
 * Pack 校验器（Node，无外部依赖；KaTeX 可选加载）。
 *
 *   import { validatePack, validatePacks, tokenizeMath, stripMath } from './validate.mjs';
 *   const { errors, warnings, stats } = validatePack(pack);
 *
 * 设计：错误 = 会让 UI 坏掉/内容错；警告 = 可以接受但值得修。
 * 所有公式在能加载 KaTeX 时做严格渲染（throwOnError），否则退化为分隔符配平检查。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION, UNSUPPORTED_MACROS, QUIZ_MIN_OPTIONS, QUIZ_MAX_OPTIONS } from './schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KATEX_PATH = path.resolve(HERE, '../../app/assets/katex/katex.min.js');

let _katex = null;
export function loadKaTeX() {
  if (_katex !== null) return _katex;
  try {
    const require = createRequire(import.meta.url);
    _katex = require(KATEX_PATH);
  } catch (e) {
    _katex = false;
  }
  return _katex;
}

/** 把文本切成 text / 行内公式 / 独立公式 三类 token（与前端 tokenizer 行为一致） */
export function tokenizeMath(text) {
  const s = String(text == null ? '' : text);
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf('$', i);
    if (j < 0) { toks.push({ t: 'text', v: s.slice(i) }); break; }
    if (j > i) toks.push({ t: 'text', v: s.slice(i, j) });
    if (s.substr(j, 2) === '$$') {
      const k = s.indexOf('$$', j + 2);
      if (k < 0) { toks.push({ t: 'text', v: s.slice(j) }); break; }
      toks.push({ t: 'D', v: s.slice(j + 2, k) });
      i = k + 2;
    } else {
      const k = s.indexOf('$', j + 1);
      if (k < 0) { toks.push({ t: 'text', v: s.slice(j) }); break; }
      toks.push({ t: 'm', v: s.slice(j + 1, k) });
      i = k + 1;
    }
  }
  return toks;
}

/** 去掉公式后的纯文本（用于 anchor 匹配：忽略空白） */
export function stripMath(text, { squash = true } = {}) {
  let out = tokenizeMath(text).filter(t => t.t === 'text').map(t => t.v).join(' ');
  return squash ? out.replace(/\s+/g, '') : out;
}

export function countMath(text) {
  let inline = 0, display = 0;
  for (const t of tokenizeMath(text)) {
    if (t.t === 'm') inline++;
    else if (t.t === 'D') display++;
  }
  return { inline, display };
}

function checkMath(where, text, errors, warnings, katex) {
  const s = String(text == null ? '' : text);
  if (s.indexOf('$') < 0) return { inline: 0, display: 0 };
  const counts = { inline: 0, display: 0 };
  for (const tok of tokenizeMath(s)) {
    // 未配对的 $ 会以 text token 形式残留下来
    if (tok.t === 'text' && tok.v.indexOf('$') >= 0) {
      errors.push(`${where} :: 未配平的 $（公式分隔符数量为奇数）`);
      break;
    }
  }
  for (const tok of tokenizeMath(s)) {
    if (tok.t === 'text') continue;
    counts[tok.t === 'm' ? 'inline' : 'display']++;
    const tex = tok.v;
    for (const rule of UNSUPPORTED_MACROS) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(tex)) errors.push(`${where} :: 不支持的写法（${rule.hint}） :: ${tex.slice(0, 100)}`);
    }
    if (katex) {
      try {
        katex.renderToString(tex, { displayMode: tok.t === 'D', throwOnError: true, strict: false });
      } catch (e) {
        errors.push(`${where} :: KaTeX: ${String(e.message).split('\n')[0]} :: $${tex.slice(0, 100)}$`);
      }
    } else if (tok.t === 'D' && tex.trim() === '') {
      warnings.push(`${where} :: 空的独立公式块`);
    }
  }
  return counts;
}

function isNonEmptyString(x) { return typeof x === 'string' && x.trim() !== ''; }

/**
 * @param {object} pack
 * @param {{katex?: any, strict?: boolean}} [opts]
 * @returns {{errors: string[], warnings: string[], stats: object}}
 */
export function validatePack(pack, opts = {}) {
  const errors = [], warnings = [];
  const stats = { chapters: 0, units: 0, quizzes: 0, glosses: 0, inlineMath: 0, displayMath: 0 };
  const katex = opts.katex === undefined ? loadKaTeX() : opts.katex;

  if (!pack || typeof pack !== 'object') return { errors: ['pack 不是对象'], warnings, stats };
  if (pack.schema !== SCHEMA_VERSION) errors.push(`pack.schema 应为 ${SCHEMA_VERSION}，实际 ${pack.schema}`);

  const meta = pack.meta || {};
  if (!isNonEmptyString(meta.id)) errors.push('meta.id 缺失');
  else if (!/^[a-z0-9][a-z0-9._-]*$/i.test(meta.id)) errors.push(`meta.id 不合规（应 URL 安全）: ${meta.id}`);
  if (!isNonEmptyString(meta.title)) errors.push('meta.title 缺失');
  if (!['zh', 'en'].includes(meta.lang)) warnings.push(`meta.lang 建议为 zh/en，实际 ${meta.lang}`);
  if (meta.authors && !Array.isArray(meta.authors)) errors.push('meta.authors 应为数组');

  const chapters = pack.chapters;
  if (!Array.isArray(chapters) || !chapters.length) {
    errors.push('pack.chapters 必须是非空数组');
    return { errors, warnings, stats };
  }

  const seenChapter = new Set(), seenUnit = new Set();
  chapters.forEach((ch, ci) => {
    stats.chapters++;
    const where = `chapter#${ci}${ch && ch.id ? '(' + ch.id + ')' : ''}`;
    if (!ch || typeof ch !== 'object') { errors.push(`${where} 不是对象`); return; }
    if (!isNonEmptyString(ch.id)) errors.push(`${where} 缺 id`);
    else if (seenChapter.has(ch.id)) errors.push(`${where} id 重复: ${ch.id}`);
    else seenChapter.add(ch.id);
    if (!isNonEmptyString(ch.title)) errors.push(`${where} 缺 title`);
    if (!Array.isArray(ch.paras) || !ch.paras.length) { errors.push(`${where} 缺 paras`); return; }
    if (ch.intro) checkMath(`${where}.intro`, ch.intro, errors, warnings, katex);

    ch.paras.forEach((p, pi) => {
      stats.units++;
      const w = `${where}.para#${pi}${p && p.id ? '(' + p.id + ')' : ''}`;
      if (!p || typeof p !== 'object') { errors.push(`${w} 不是对象`); return; }
      if (!isNonEmptyString(p.id)) errors.push(`${w} 缺 id`);
      else if (seenUnit.has(p.id)) errors.push(`${w} unit id 重复: ${p.id}`);
      else seenUnit.add(p.id);
      if (!isNonEmptyString(p.title)) errors.push(`${w} 缺 title`);
      if (!isNonEmptyString(p.raw)) errors.push(`${w} 缺 raw`);
      if (!isNonEmptyString(p.explain)) {
        if (p.raw) warnings.push(`${w} explain 为空（仅原文可读，AI 讲解仍可用）`);
        else errors.push(`${w} 缺 explain`);
      }
      if (p.tags !== undefined && !Array.isArray(p.tags)) errors.push(`${w} tags 应为数组`);
      if (p.objectives !== undefined && !Array.isArray(p.objectives)) errors.push(`${w} objectives 应为数组`);

      const c1 = checkMath(`${w}.raw`, p.raw, errors, warnings, katex);
      const c2 = checkMath(`${w}.explain`, p.explain, errors, warnings, katex);
      const c3 = checkMath(`${w}.alt`, p.alt, errors, warnings, katex);
      const c4 = checkMath(`${w}.deep`, p.deep, errors, warnings, katex);
      stats.inlineMath += c1.inline + c2.inline + c3.inline + c4.inline;
      stats.displayMath += c1.display + c2.display + c3.display + c4.display;

      const rawPlain = stripMath(p.raw || '');
      (p.gloss || []).forEach((g, gi) => {
        stats.glosses++;
        if (!g || !isNonEmptyString(g.anchor)) { errors.push(`${w}.gloss#${gi} 缺 anchor`); return; }
        if (!isNonEmptyString(g.note)) errors.push(`${w}.gloss#${gi} 缺 note`);
        const anchor = stripMath(g.anchor);
        if (rawPlain.indexOf(anchor) < 0) errors.push(`${w}.gloss#${gi} anchor 不在 raw 纯文本中: ${anchor}`);
        checkMath(`${w}.gloss#${gi}.note`, g.note, errors, warnings, katex);
      });

      (p.quiz || []).forEach((q, qi) => {
        stats.quizzes++;
        if (!q || !isNonEmptyString(q.q)) { errors.push(`${w}.quiz#${qi} 缺 q`); return; }
        const opts2 = q.options || [];
        if (!Array.isArray(opts2) || opts2.length < QUIZ_MIN_OPTIONS) errors.push(`${w}.quiz#${qi} 选项少于 ${QUIZ_MIN_OPTIONS}`);
        if (opts2.length > QUIZ_MAX_OPTIONS) warnings.push(`${w}.quiz#${qi} 选项过多（${opts2.length}）`);
        if (typeof q.answer !== 'number' || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= opts2.length) {
          errors.push(`${w}.quiz#${qi} answer 越界或非整数: ${q.answer}`);
        }
        if (!isNonEmptyString(q.hint)) warnings.push(`${w}.quiz#${qi} 缺 hint`);
        if (!isNonEmptyString(q.why)) warnings.push(`${w}.quiz#${qi} 缺 why`);
        checkMath(`${w}.quiz#${qi}.q`, q.q, errors, warnings, katex);
        opts2.forEach((o, oi) => checkMath(`${w}.quiz#${qi}.opt${oi}`, o, errors, warnings, katex));
        checkMath(`${w}.quiz#${qi}.hint`, q.hint, errors, warnings, katex);
        checkMath(`${w}.quiz#${qi}.why`, q.why, errors, warnings, katex);
      });

      (p.faq || []).forEach((f, fi) => {
        if (!f || !isNonEmptyString(f.q) || !isNonEmptyString(f.a)) errors.push(`${w}.faq#${fi} 缺 q/a`);
      });
      (p.legend || []).forEach((l, li) => {
        if (!l || !isNonEmptyString(l.sym) || !isNonEmptyString(l.desc)) errors.push(`${w}.legend#${li} 缺 sym/desc`);
        checkMath(`${w}.legend#${li}.sym`, l.sym, errors, warnings, katex);
      });
    });
  });

  return { errors, warnings, stats };
}

/** 校验一组 pack：逐个校验 + 跨包 id 唯一 */
export function validatePacks(packs, opts = {}) {
  const errors = [], warnings = [], perPack = [];
  const ids = new Map();
  (packs || []).forEach((pack, i) => {
    const r = validatePack(pack, opts);
    const id = pack && pack.meta && pack.meta.id;
    if (id) {
      if (ids.has(id)) errors.push(`meta.id 重复: ${id}（pack#${i} 与 pack#${ids.get(id)}）`);
      else ids.set(id, i);
    }
    perPack.push({ id, index: i, ...r });
    errors.push(...r.errors.map(e => `[${id || 'pack#' + i}] ${e}`));
    warnings.push(...r.warnings.map(w => `[${id || 'pack#' + i}] ${w}`));
  });
  const ZERO = { chapters: 0, units: 0, quizzes: 0, glosses: 0, inlineMath: 0, displayMath: 0 };
  const stats = perPack.reduce((acc, r) => {
    for (const k of Object.keys(r.stats)) acc[k] = (acc[k] || 0) + r.stats[k];
    acc.packs = (acc.packs || 0) + 1;
    return acc;
  }, { ...ZERO });
  return { errors, warnings, perPack, stats };
}
