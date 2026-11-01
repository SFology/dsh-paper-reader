/* ============================================================
 * 模板读包 —— 复制这个目录开始你的第一个读包：
 *
 *   mkdir content/mypaper
 *   copy content/_template/* content/mypaper/
 *   # 改 id / title，然后 npm run build
 *
 * 或者直接：npm run new -- --id mypaper --title "我的论文"
 * 规范：docs/CONTENT_FORMAT.md
 * ============================================================ */
(function () {
  var PAPERS = (window.PAPERS = window.PAPERS || []);
  var P = (window.__PACK__ = {
    schema: 1,
    meta: {
      id: 'template',
      title: '模板读包',
      subtitle: '复制我，然后改 id 与 title',
      authors: [],
      year: null,
      venue: '',
      url: '',
      license: '',
      lang: 'zh',
      source: '',
      tags: ['示例'],
      abstract: '',
      version: '0.1.0',
      readingTime: '',
      assistant: null
    },
    chapters: []
  });
  PAPERS.push(P);
})();
