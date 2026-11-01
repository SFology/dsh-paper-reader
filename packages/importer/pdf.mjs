/**
 * pdf.mjs — 调 pdf.py（PyMuPDF）抽取 PDF 文本，再组装成读包 chapters。
 *
 * PyMuPDF 解释器候选顺序：$PAPER_READER_PYTHON → $DSH_PYTHON → $PYTHON →
 * E:\anaconda3\python.exe → python3 → python → py。
 * 全都不可用时抛出固定文案的错误，提示改用 Markdown 输入。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeChapters } from './markdown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PDF_PY = path.join(HERE, 'pdf.py');

export const PYTHON_NOT_FOUND =
  '未找到 PyMuPDF 解释器，请安装 python3 + pymupdf 或改用 Markdown 输入';

let _python; // undefined = 未探测；null = 没有

/** 找一个能 import PyMuPDF 的解释器；找不到返回 null */
export function findPython() {
  if (_python !== undefined) return _python;
  const fromEnv = [process.env.PAPER_READER_PYTHON, process.env.DSH_PYTHON, process.env.PYTHON]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  const candidates = [...new Set([
    ...fromEnv,
    'E:\\anaconda3\\python.exe',
    'python3',
    'python',
    'py'
  ])];
  for (const cmd of candidates) {
    for (const mod of ['pymupdf', 'fitz']) {
      const r = spawnSync(cmd, ['-c', 'import ' + mod], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20000
      });
      if (!r.error && r.status === 0) {
        _python = cmd;
        return _python;
      }
    }
  }
  _python = null;
  return _python;
}

/** 运行 pdf.py，返回 {pages, meta} */
export function extractPdf(file) {
  const input = path.resolve(String(file || ''));
  if (!file || !fs.existsSync(input)) throw new Error('PDF 文件不存在：' + input);
  const py = findPython();
  if (!py) throw new Error(PYTHON_NOT_FOUND);

  const r = spawnSync(py, [PDF_PY, input], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 256 * 1024 * 1024
  });
  if (r.error) {
    if (r.error.code === 'ETIMEDOUT') throw new Error('PDF 抽取超时（>180s）：' + input);
    throw new Error('调用 Python 失败（' + py + '）：' + r.error.message);
  }
  if (r.status !== 0) {
    const detail = String(r.stderr || '').trim().split('\n').slice(-3).join(' ');
    throw new Error('PDF 抽取失败：' + (detail || 'python 退出码 ' + r.status));
  }
  let data;
  try {
    data = JSON.parse(String(r.stdout || '').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error('pdf.py 输出无法解析为 JSON：' + String(e.message).slice(0, 200));
  }
  const pages = Array.isArray(data.pages) ? data.pages : [];
  return {
    pages: pages.map((p, i) => ({ no: Number(p && p.no) || i + 1, text: String((p && p.text) || '') })),
    meta: data.meta && typeof data.meta === 'object' ? data.meta : {}
  };
}

const KNOWN_HEADING =
  /^(?:abstract|introduction|related\s+work|background|preliminaries|problem\s+(?:setup|formulation)|method(?:ology)?|approach|experiments?|empirical\s+(?:results|study)|results?|discussion|conclusions?|references|bibliography|appendix|acknowledg(?:e)?ments?)\b/i;

/** 启发式判断一个 PDF 段落是否是（一级）标题 */
export function isHeadingParagraph(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80) return false;
  if (/[.,;:。，；：]$/.test(t)) return false;
  const words = t.split(' ');
  if (words.length > 12) return false;
  if (/^\d+(?:\.\d+){0,3}[.、)]?\s+\S/.test(t)) return true;
  if (/^(?:第[一二三四五六七八九十百0-9]+[章节部分]|[一二三四五六七八九十]+[、.])\s*\S/.test(t)) return true;
  if (KNOWN_HEADING.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase() && words.length <= 10) return true;
  return false;
}

function splitParagraphs(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * pages → 原始章：识别标题则每标题一章；否则每 pagesPerChapter 页一章，章名「第 N 页」。
 * @param {Array<{no:number,text:string}>} pages
 * @param {{pagesPerChapter?: number}} [opts]
 */
export function pagesToRawChapters(pages, opts = {}) {
  const per = Math.max(1, Number(opts.pagesPerChapter) || 3);
  const list = Array.isArray(pages) ? pages : [];

  const items = [];
  for (const page of list) {
    for (const para of splitParagraphs(page.text)) {
      items.push({ no: Number(page.no) || 0, text: para, heading: isHeadingParagraph(para) });
    }
  }

  const headings = items.filter((it) => it.heading);
  if (headings.length >= 2) {
    const chapters = [];
    let cur = null;
    for (const it of items) {
      if (it.heading) {
        cur = { title: it.text.trim(), paras: [] };
        chapters.push(cur);
        continue;
      }
      if (!cur) {
        cur = { title: '前言', paras: [] };
        chapters.push(cur);
      }
      cur.paras.push({ kind: 'text', text: it.text, section: '' });
    }
    const kept = chapters.filter((c) => c.paras.length);
    if (kept.length) return kept;
  }

  // 没有可识别的标题：按每 N 页一章，章名 = 起始页码
  const chapters = [];
  for (let i = 0; i < list.length; i += per) {
    const group = list.slice(i, i + per);
    const first = Number(group[0] && group[0].no) || i + 1;
    const paras = [];
    for (const page of group) {
      for (const para of splitParagraphs(page.text)) {
        paras.push({ kind: 'text', text: para, section: '' });
      }
    }
    if (paras.length) chapters.push({ title: '第 ' + first + ' 页', paras });
  }
  return chapters;
}

/**
 * PDF → {chapters, warnings, meta, pageCount}
 * @param {string} file
 * @param {{placeholder?: boolean, maxUnits?: number, pagesPerChapter?: number}} [opts]
 */
export function importPdf(file, opts = {}) {
  const { pages, meta } = extractPdf(file);
  const rawChapters = pagesToRawChapters(pages, opts);
  if (!rawChapters.length) throw new Error('PDF 未抽取到可用文本（可能是扫描件或无文字层）');
  const { chapters, warnings } = finalizeChapters(rawChapters, opts);
  return { chapters, warnings, meta, pageCount: pages.length };
}
