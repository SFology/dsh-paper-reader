/**
 * Pack schema (v1) — 常量与默认值。
 * 规范见 docs/CONTENT_FORMAT.md。这里是唯一的"事实来源"。
 */

export const SCHEMA_VERSION = 1;

export const META_REQUIRED = ['id', 'title', 'lang'];
export const META_DEFAULTS = {
  subtitle: '',
  authors: [],
  year: null,
  venue: '',
  url: '',
  license: '',
  source: '',
  tags: [],
  abstract: '',
  version: '0.1.0',
  readingTime: '',
  assistant: null
};

export const UNIT_REQUIRED = ['id', 'title', 'raw', 'explain'];
export const UNIT_OPTIONAL = ['alt', 'deep', 'tags', 'objectives', 'source', 'gloss', 'quiz', 'faq', 'legend'];

export const CHAPTER_REQUIRED = ['id', 'title', 'paras'];

export const QUIZ_MIN_OPTIONS = 2;
export const QUIZ_MAX_OPTIONS = 6;

/**
 * 内置 KaTeX 是精简版（离线、体积可控），下面这些 LaTeX 常见写法都渲染不了。
 * 每条给一个可执行的替换建议；`scripts/fix-math.mjs` 会按前 4 条自动改。
 */
export const UNSUPPORTED_MACROS = [
  { pattern: /\\dots\b/g, hint: '用 \\ldots（或 \\cdots）', fix: 'dots' },
  { pattern: /\\boxed\s*\{/g, hint: '不支持 \\boxed，去掉外框（保留内容）', fix: 'boxed' },
  { pattern: /\\fbox\s*\{/g, hint: '不支持 \\fbox', fix: 'fbox' },
  { pattern: /\\colorbox\s*\{[^}]*\}\s*\{/g, hint: '不支持 \\colorbox', fix: 'colorbox' },
  { pattern: /\\tag\s*\{/g, hint: '不支持 \\tag，编号写成正文文字', fix: 'tag' },
  { pattern: /\\operatorname\s*\{/g, hint: '用 \\mathrm{} 代替 \\operatorname{}', fix: 'operatorname' },
  { pattern: /\\mathop\s*\{/g, hint: '不支持 \\mathop，改用 \\mathrm{}', fix: 'mathop' },
  { pattern: /\\underbrace\s*\{/g, hint: '不支持 \\underbrace，改写为 (…)_{说明}', fix: 'underbrace' },
  { pattern: /\\overbrace\s*\{/g, hint: '不支持 \\overbrace，改写为 (…)^{说明}', fix: 'overbrace' },
  { pattern: /\\substack\s*\{/g, hint: '不支持 \\substack，拆成多行公式', fix: 'substack' },
  { pattern: /\\bm\s*\{/g, hint: '用 \\mathbf{} 代替 \\bm{}', fix: 'bm' },
  { pattern: /\\boldsymbol\s*\{/g, hint: '用 \\mathbf{} 代替 \\boldsymbol{}', fix: 'boldsymbol' },
  { pattern: /\\overset\b/g, hint: 'KaTeX 不支持 \\overset，改写为文字说明或 =_{d}' },
  { pattern: /\\underset\b/g, hint: 'KaTeX 不支持 \\underset' },
  { pattern: /\\begin\{align\}/g, hint: '不支持 align 环境，拆成多个 $$…$$（aligned 可用）' },
  { pattern: /\\text\{[^}]*[\u4e00-\u9fff][^}]*\}/g, hint: 'CJK 不能放进 \\text{}，请移到公式外' },
  { pattern: /\\label\{/g, hint: 'KaTeX 不支持 \\label' },
  { pattern: /\\ref\{/g, hint: 'KaTeX 不支持 \\ref' }
];

export function emptyPack(id, title, lang = 'zh') {
  return {
    schema: SCHEMA_VERSION,
    meta: { ...META_DEFAULTS, id, title, lang },
    chapters: []
  };
}
