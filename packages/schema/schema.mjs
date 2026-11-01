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

/** KaTeX 里不支持、但常见于 LaTeX 稿的写法 → 替换建议 */
export const UNSUPPORTED_MACROS = [
  { pattern: /\\dots\b/g, hint: '用 \\ldots 或 \\cdots' },
  { pattern: /\\overset\b/g, hint: 'KaTeX 不支持 \\overset，改写为文字说明或 =_{d}' },
  { pattern: /\\underset\b/g, hint: 'KaTeX 不支持 \\underset' },
  { pattern: /\\begin\{align\}/g, hint: '不支持 align 环境，拆成多个 $$…$$' },
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
