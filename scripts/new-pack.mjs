#!/usr/bin/env node
/**
 * 新建读包骨架。
 *
 *   npm run new -- --id mypaper --title "我的论文"
 *   npm run new -- --id mynotes --title "读书笔记" --lang en
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const id = arg('id', '');
const title = arg('title', '');
const lang = arg('lang', 'zh');
const author = arg('author', '');

if (!id || !title) {
  console.error('用法：npm run new -- --id <packId> --title "标题" [--lang zh|en] [--author 名字]');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
  console.error('✗ id 只能包含字母、数字、- _ .（用于 URL 与文件名），例如 my-paper');
  process.exit(1);
}

const dir = path.join(ROOT, 'content', id);
if (fs.existsSync(dir)) {
  console.error('✗ 目录已存在：content/' + id);
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const packFile = `/* ============================================================
 * 读包：${title}
 * 规范见 docs/CONTENT_FORMAT.md
 * ============================================================ */
(function () {
  var PAPERS = (window.PAPERS = window.PAPERS || []);
  var P = (window.__PACK__ = {
    schema: 1,
    meta: {
      id: '${id}',
      title: '${esc(title)}',
      subtitle: '',
      authors: [${author ? "'" + esc(author) + "'" : ''}],
      year: null,
      venue: '',
      url: '',
      license: '',
      lang: '${lang}',
      source: '',
      tags: [],
      abstract: '',
      version: '0.1.0',
      readingTime: '',
      assistant: null
    },
    chapters: []
  });
  PAPERS.push(P);
})();
`;

const bodyFile = `/* ${title} · 正文：往 P.chapters 里 push 章节与单元 */
(function () {
  var r = String.raw;              // 必须：否则 LaTeX 反斜杠会被 JS 吃掉
  var P = window.__PACK__;

  P.chapters.push({
    id: 'c1', num: '1', title: '第一章：把标题改成真实的小节名',
    intro: '章首导语（可留空）。它只出现一次，用来交代这一章要解决什么。',
    paras: [
      {
        id: 'c1p1',
        title: '这一段的标题（目录里显示）',
        tags: ['核心'],
        raw: r\`原文要点。公式写成 $E = mc^2$ 或 $$\\int_0^1 f(x)\\,dx$$。
一段可以有多句；精读器会按句子切开，便于逐句划线和批注。\`,

        explain: r\`离线讲解：这一段在讲什么、为什么这样讲、最容易卡在哪一步。

写作建议（写完删掉这段）：
1. 先说直觉，再说形式化；
2. 把"为什么需要这个定义/定理"讲出来，而不是复述；
3. 指出常见误解。\`,

        alt: r\`换一种讲法（读者点「还没懂」时看到）。\`,

        gloss: [
          { anchor: '原文要点', note: r\`逐句注解：anchor 必须逐字出现在 raw 里（去掉公式后）。\` }
        ],

        quiz: [{
          q: r\`这段的核心结论是？\`,
          options: [r\`选项 A\`, r\`选项 B\`, r\`选项 C\`],
          answer: 1,
          hint: r\`提示：看第二句。\`,
          why: r\`解析：说明为什么 B 对、其它错在哪。\`
        }],

        faq: [
          { q: r\`为什么这里要假设紧性？\`, a: r\`解答……\` }
        ],

        legend: [
          { sym: r\`$E$\`, desc: '能量' }
        ]
      }
    ]
  });
})();
`;

fs.writeFileSync(path.join(dir, '00_pack.js'), packFile, 'utf8');
fs.writeFileSync(path.join(dir, '01_body.js'), bodyFile, 'utf8');

console.log('✓ 已创建 content/' + id + '/');
console.log('  00_pack.js  — meta（id/title/lang）');
console.log('  01_body.js  — 章节与单元骨架');
console.log('\n下一步：');
console.log('  1. 编辑 content/' + id + '/01_body.js 写真实的 raw / explain');
console.log('  2. npm run build      # 生成 app/packs.js 并校验');
console.log('  3. npm start          # 打开精读器，右上角可切换读包');
