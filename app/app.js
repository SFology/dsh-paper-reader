/* 论文精读器 · 交互逻辑（本地 KaTeX + 本地 LLM 网关 + 多读包） */
(function () {
  'use strict';

  /* ============ 读包（支持多篇） ============ */
  var PACKS_RAW = (window.PAPERS || []).filter(function (p) { return p && p.meta && p.chapters && p.chapters.length; });
  var HAS_PACKS = PACKS_RAW.length > 0;   // 仓库自带 0 个读包是常态：此时显示引导页
  var PAPERS = HAS_PACKS ? PACKS_RAW : [{ schema: 1, meta: { id: 'empty', title: '（未加载任何读包）', lang: 'zh' }, chapters: [] }];
  var paper = PAPERS[0] || { meta: { id: '', title: '论文精读器', chapters: [] }, chapters: [] };

  var LSKEY = 'paper-reader-v1';
  var OLDKEYS = [];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ============ 嵌入模式（DSH 插件 iframe） ============ */
  var EMBEDDED = (function () { try { return !!(window.parent && window.parent !== window); } catch (e) { return false; } })();
  /** 把批注/状态抛给宿主（DSH 插件监听 postMessage） */
  function notifyEmbed(type, payload) {
    if (!EMBEDDED) return;
    try {
      window.parent.postMessage(Object.assign({ source: 'paper-reader', type: type }, payload || {}), '*');
    } catch (e) { /* 跨域宿主可能拒绝，忽略 */ }
  }
  /** 宿主 -> 精读器 的指令：跳单元 / 切读包 */
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.target !== 'paper-reader') return;
    try {
      if (d.type === 'goto' && d.unitId && IDX[d.unitId] !== undefined) go(IDX[d.unitId]);
      if (d.type === 'setPaper' && d.paperId && paperById(d.paperId)) switchPaper(d.paperId);
      if (d.type === 'ask') sendFromInput && d.text && askAI(String(d.text));
    } catch (e) { /* 忽略 */ }
  });

  /* ============ 状态 ============ */
  var storeOK = (function () { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch (e) { return false; } })();
  var memStore = {};
  var state = { paper: paper.meta.id || '', mode: 'study', cur: 0, prog: {}, ann: {}, books: {}, st: { font: 17, theme: 'light' } };
  function save() {
    var s = JSON.stringify(state);
    if (storeOK) { try { localStorage.setItem(LSKEY, s); } catch (e) {} } else { memStore[LSKEY] = s; }
  }
  function load() {
    var raw = storeOK ? (function () { try { return localStorage.getItem(LSKEY); } catch (e) { return null; } })() : memStore[LSKEY];
    if (!raw) {
      // 兼容旧版本（单读包）的进度
      for (var i = 0; i < OLDKEYS.length && !raw; i++) {
        try { raw = storeOK ? localStorage.getItem(OLDKEYS[i]) : memStore[OLDKEYS[i]]; } catch (e) {}
        if (raw) { try { raw = JSON.stringify(Object.assign(JSON.parse(raw), { paper: PAPERS[0].meta.id })); } catch (e) { raw = null; } }
      }
    }
    if (!raw) return;
    try {
      var o = JSON.parse(raw); if (!o) return;
      state.mode = o.mode === 'browse' ? 'browse' : 'study';
      state.paper = o.paper || paper.meta.id;
      state.cur = typeof o.cur === 'number' ? o.cur : 0;
      state.prog = o.prog || {}; state.ann = o.ann || {};
      state.books = o.books || {};
      // 把"当前活跃书"的进度放回 books，随后由 setPaper() 统一载入（避免串书）
      state.books[state.paper] = { cur: state.cur, prog: state.prog, ann: state.ann };
      state.cur = 0; state.prog = {}; state.ann = {};
      if (o.st) { state.st.font = o.st.font || 17; state.st.theme = o.st.theme || 'light'; }
    } catch (e) {}
  }

  /* ============ 索引（多读包） ============ */
  var FLAT = [], IDX = {};
  function rebuildIndex() {
    FLAT = []; IDX = {};
    (paper.chapters || []).forEach(function (ch, ci) {
      (ch.paras || []).forEach(function (p) { IDX[p.id] = FLAT.length; FLAT.push({ ci: ci, ch: ch, p: p }); });
    });
  }
  rebuildIndex();
  function total() { return FLAT.length; }
  function curEntry() { return FLAT[state.cur] || FLAT[0]; }
  function progOf(pid) {
    if (!state.prog[pid]) state.prog[pid] = { status: 'new', answers: [], tries: 0, showAlt: false };
    return state.prog[pid];
  }
  function statusOf(pid) { var pr = state.prog[pid]; return pr && pr.status ? pr.status : 'new'; }

  function paperById(id) {
    for (var i = 0; i < PAPERS.length; i++) if (PAPERS[i].meta.id === id) return PAPERS[i];
    return null;
  }
  /** 切换读包：把当前书的进度存进 state.books，再载入目标书 */
  function setPaper(id) {
    var next = paperById(id) || PAPERS[0];
    if (paper && paper !== next) {
      state.books[paper.meta.id] = { cur: state.cur, prog: state.prog, ann: state.ann };
    }
    paper = next;
    var bk = state.books[paper.meta.id];
    state.cur = bk ? (bk.cur || 0) : 0;
    state.prog = bk ? (bk.prog || {}) : {};
    state.ann = bk ? (bk.ann || {}) : {};
    state.paper = paper.meta.id;
    rebuildIndex();
    state.cur = Math.max(0, Math.min(Math.max(0, total() - 1), state.cur || 0));
  }
  function switchPaper(id) {
    if (id === paper.meta.id) return;
    setPaper(id);
    save();
    var sel = $('#paperSel'); if (sel) sel.value = paper.meta.id;
    render(); renderTOC(); updateProgress();
    if (railTab) renderRail();
    var t = $('#paperTitle'); if (t) t.textContent = paper.meta.title || '';
    var st2 = $('#srcline'); if (st2) st2.textContent = paper.meta.source || '';
    window.scrollTo(0, 0);
  }


  /* ============ 文本 / 公式 ============ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function mathHTML(tex, display) {
    try { return window.katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: false, trust: false }); }
    catch (e) { return '<code>' + esc(tex) + '</code>'; }
  }
  function tokenize(text) {
    text = String(text == null ? '' : text);
    var toks = [], i = 0, n = text.length;
    while (i < n) {
      var j = text.indexOf('$', i);
      if (j < 0) { toks.push({ t: 'text', v: text.slice(i) }); break; }
      if (j > i) toks.push({ t: 'text', v: text.slice(i, j) });
      if (text.substr(j, 2) === '$$') {
        var k = text.indexOf('$$', j + 2);
        if (k < 0) { toks.push({ t: 'text', v: text.slice(j) }); break; }
        toks.push({ t: 'D', v: text.slice(j + 2, k) }); i = k + 2;
      } else {
        var k2 = text.indexOf('$', j + 1);
        if (k2 < 0) { toks.push({ t: 'text', v: text.slice(j) }); break; }
        toks.push({ t: 'm', v: text.slice(j + 1, k2) }); i = k2 + 1;
      }
    }
    return toks;
  }
  var PUNCT = '。！？；', RAW = {};
  function sentenceize(text, pid) {
    var toks = tokenize(text), sents = [], pieces = [], cur = null, bold = false;
    function fresh() { cur = { html: '', raw: '', plain: '' }; }
    function flush() {
      if (!cur) return;
      if (cur.html.trim() !== '' || cur.plain.trim() !== '') {
        var sid = 's' + sents.length;
        sents.push({ sid: sid, html: cur.html, raw: cur.raw, plain: cur.plain });
        pieces.push({ type: 'sent', sid: sid });
      }
      cur = null;
    }
    fresh();
    for (var t = 0; t < toks.length; t++) {
      var tk = toks[t];
      if (tk.t === 'D') { flush(); pieces.push({ type: 'block', html: '<div class="mathblock">' + mathHTML(tk.v, true) + '</div>' }); fresh(); continue; }
      if (tk.t === 'm') {
        if (!cur) fresh();
        cur.html += '<span class="math">' + mathHTML(tk.v, false) + '</span>';
        cur.raw += '$' + tk.v + '$'; cur.plain += ' ';
        continue;
      }
      var parts = tk.v.split(/([。！？；\n])/);
      for (var q = 0; q < parts.length; q++) {
        var part = parts[q];
        if (part === '') continue;
        if (part === '\n') { flush(); fresh(); continue; }
        // **加粗**：标记可能跨句，用跨 chunk 的 bold 状态传递；输出时把标记去掉
        var segs = part.split('**');
        for (var z = 0; z < segs.length; z++) {
          if (z > 0) bold = !bold;
          var seg = segs[z];
          if (seg === '') continue;
          if (!cur) fresh();
          cur.html += bold ? '<strong>' + esc(seg) + '</strong>' : esc(seg);
          cur.raw += seg; cur.plain += seg;
        }
        if (PUNCT.indexOf(part) >= 0) { flush(); fresh(); }
      }
    }
    flush();
    var bySid = {};
    sents.forEach(function (s) { bySid[s.sid] = s; });
    var html = pieces.map(function (pc) {
      if (pc.type === 'block') return pc.html;
      return '<span class="sent" data-pid="' + pid + '" data-sid="' + pc.sid + '">' + bySid[pc.sid].html + '</span>';
    }).join('');
    return { html: html, sents: sents, bySid: bySid };
  }
  function inlineRich(s) {
    return tokenize(s).map(function (tk) {
      if (tk.t === 'D') return '<div class="mathblock">' + mathHTML(tk.v, true) + '</div>';
      if (tk.t === 'm') return '<span class="math">' + mathHTML(tk.v, false) + '</span>';
      return esc(tk.v).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    }).join('');
  }
  function prose(text) {
    if (!text) return '';
    return String(text).split(/\n{2,}/).map(function (b) {
      var t = b.trim(); if (!t) return '';
      if (/^\$\$[\s\S]*\$\$$/.test(t)) return '<div class="mathblock">' + mathHTML(t.slice(2, -2), true) + '</div>';
      var lines = t.split('\n');
      if (lines.length > 1 && lines.every(function (l) { return /^\s*[-•]\s+/.test(l); })) {
        return '<ul>' + lines.map(function (l) { return '<li>' + inlineRich(l.replace(/^\s*[-•]\s+/, '')) + '</li>'; }).join('') + '</ul>';
      }
      return '<p>' + inlineRich(t).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function md(text) {
    var parts = String(text || '').split('```');
    return parts.map(function (seg, i) {
      if (i % 2 === 1) {
        var body = seg.replace(/^[a-zA-Z0-9_+.#-]*\n/, '');
        return '<pre class="code"><code>' + esc(body.replace(/\s+$/, '')) + '</code></pre>';
      }
      return mdText(seg);
    }).join('');
  }
  function mdText(s) {
    var out = [], ul = false;
    function closeList() { if (ul) { out.push('</ul>'); ul = false; } }
    String(s).split('\n').forEach(function (line) {
      var t = line.replace(/\s+$/, '');
      if (/^\s*$/.test(t)) { closeList(); out.push('<div style="height:7px"></div>'); return; }
      var h = /^(#{1,4})\s+(.*)$/.exec(t);
      if (h) { closeList(); out.push('<p class="mdh">' + inlineRich(h[2]) + '</p>'); return; }
      if (/^\s*[-*•]\s+/.test(t)) {
        if (!ul) { out.push('<ul class="mdul">'); ul = true; }
        out.push('<li>' + inlineRich(t.replace(/^\s*[-*•]\s+/, '')) + '</li>'); return;
      }
      if (/^\s*\d+[.)]\s+/.test(t)) {
        if (!ul) { out.push('<ul class="mdul">'); ul = true; }
        out.push('<li>' + inlineRich(t.replace(/^\s*\d+[.)]\s+/, '')) + '</li>'); return;
      }
      if (/^\s*>/.test(t)) { closeList(); out.push('<blockquote>' + inlineRich(t.replace(/^\s*>\s?/, '')) + '</blockquote>'); return; }
      closeList();
      out.push('<p>' + inlineRich(t) + '</p>');
    });
    closeList();
    return out.join('');
  }

  /* ============ 小工具 ============ */
  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast('已复制'); }, function () { fallbackCopy(t); });
    } else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }
  function promptText(pid, quote, note) {
    var e = FLAT[IDX[pid]] || curEntry();
    var lines = ['【精读提问】', '章节：' + e.ch.title + (e.p.title ? ' · ' + e.p.title : ''), ''];
    if (quote) lines.push('原文：' + quote, '');
    if (note) lines.push('我的批注 / 问题：' + note, '');
    lines.push('请结合上下文解释，并指出我的理解里可能存在的问题。');
    return lines.join('\n');
  }
  function applyFont() { document.documentElement.style.fontSize = state.st.font + 'px'; }

  /* ============ 逐句注解 / 深讲（离线兜底） ============ */
  function glossSentenceMap(pid) {
    var e = FLAT[IDX[pid]], sq = RAW[pid];
    if (!e || !e.p.gloss || !sq) return {};
    var map = {};
    e.p.gloss.forEach(function (g) {
      var anchor = String(g.anchor || '').replace(/\s+/g, '');
      if (!anchor) return;
      for (var i = 0; i < sq.sents.length; i++) {
        if (sq.sents[i].plain.replace(/\s+/g, '').indexOf(anchor) >= 0) { map[sq.sents[i].sid] = true; return; }
      }
    });
    return map;
  }
  function deepFor(pid, sids) {
    var e = FLAT[IDX[pid]]; if (!e) return null;
    var p = e.p, sq = RAW[pid];
    if (p.gloss && sq) {
      for (var i = 0; i < p.gloss.length; i++) {
        var anchor = String(p.gloss[i].anchor || '').replace(/\s+/g, '');
        for (var j = 0; j < (sids || []).length; j++) {
          var s = sq.bySid[sids[j]];
          if (s && s.plain.replace(/\s+/g, '').indexOf(anchor) >= 0) return p.gloss[i].note;
        }
      }
    }
    return p.deep || null;
  }

  /* ============ 批注 ============ */
  function addAnnot(pid, sids, quote, note) {
    var list = state.ann[pid] || (state.ann[pid] = []);
    list.push({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), sids: sids || [], quote: quote || '', note: note || '', ts: Date.now() });
    save(); applyHighlights(pid); renderAnnTab(); updateProgress(); toast('已保存批注');
    notifyEmbed('annotation', {
      paper: paper.meta.id,
      paperTitle: paper.meta.title,
      unit: pid,
      unitTitle: (FLAT[IDX[pid]] ? FLAT[IDX[pid]].p.title : ''),
      quote: quote || '',
      note: note || ''
    });
    if (AI.autoAnnot && AI.ready && note && note.trim()) {
      railTab = 'ai'; setRailWidth(); renderRail();
      askAI('我刚在这句原文上写了一条批注，请针对它讲解：' + note.trim(), { pid: pid, sids: sids, quote: quote, note: note });
    }
  }
  function findAnn(pid, aid) { return (state.ann[pid] || []).filter(function (a) { return a.id === aid; })[0]; }
  function editAnnot(pid, aid) {
    var a = findAnn(pid, aid); if (!a) return;
    openModal('编辑批注', a.quote, a.note, function (txt) {
      a.note = txt; a.ts = Date.now(); save(); applyHighlights(pid); renderAnnTab(); toast('已更新');
    });
  }
  function delAnnot(pid, aid) {
    state.ann[pid] = (state.ann[pid] || []).filter(function (a) { return a.id !== aid; });
    if (!state.ann[pid].length) delete state.ann[pid];
    save(); applyHighlights(pid); renderAnnTab(); hidePop(); toast('已删除');
  }
  function applyHighlights(pid) {
    var list = state.ann[pid] || [], map = {};
    list.forEach(function (a) { (a.sids || []).forEach(function (s) { map[s] = true; }); });
    var gmap = glossSentenceMap(pid);
    $$('.sent[data-pid="' + pid + '"]').forEach(function (el) {
      el.classList.toggle('hl', !!map[el.dataset.sid]);
      el.classList.toggle('has-gloss', !!gmap[el.dataset.sid]);
    });
  }

  /* ============ 弹窗 / 气泡 ============ */
  function hidePop() { var el = $('#pop'); el.style.display = 'none'; el.innerHTML = ''; }
  function showPop(rect, html) {
    var el = $('#pop'); el.innerHTML = html; el.style.display = 'block';
    var w = el.offsetWidth, h = el.offsetHeight;
    var x = Math.min(Math.max(10, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 10);
    var y = rect.top - h - 10;
    if (y < 60) y = rect.bottom + 10;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  var modalSave = null;
  function openModal(title, quote, initial, onSave) {
    modalSave = onSave;
    $('#mTitle').textContent = title;
    $('#mQuote').textContent = quote ? '「' + (quote.length > 150 ? quote.slice(0, 150) + '…' : quote) + '」' : '';
    $('#mInfo').style.display = 'none';
    $('#mNote').style.display = ''; $('#mNote').value = initial || '';
    $('#mSave').textContent = '保存';
    $('#modal').style.display = 'block';
    setTimeout(function () { $('#mNote').focus(); }, 30);
  }
  function openInfo(title, quote, html) {
    modalSave = null;
    $('#mTitle').textContent = title;
    $('#mQuote').textContent = quote ? '「' + (quote.length > 150 ? quote.slice(0, 150) + '…' : quote) + '」' : '';
    $('#mNote').style.display = 'none';
    $('#mInfo').innerHTML = html; $('#mInfo').style.display = 'block';
    $('#mSave').textContent = '知道了';
    $('#modal').style.display = 'block';
  }
  function closeModal() { $('#modal').style.display = 'none'; modalSave = null; }

  /* ============ 舞台 ============ */
  function quizAllCorrect(p) {
    if (!p.quiz || !p.quiz.length) return true;
    var pr = progOf(p.id);
    for (var i = 0; i < p.quiz.length; i++) if (pr.answers[i] !== p.quiz[i].answer) return false;
    return true;
  }
  function renderStudy() {
    var e = curEntry(); if (!e) return;
    var p = e.p, pr = progOf(p.id), sq = sentenceize(p.raw || '', p.id);
    RAW[p.id] = sq;
    var idx = state.cur + 1, quizHTML = '';
    if (p.quiz && p.quiz.length) {
      quizHTML = '<div class="card quiz"><div class="cardlabel">自测 · 答对才放行</div>' + p.quiz.map(function (qz, qi) {
        var chosen = pr.answers[qi];
        var opts = (qz.options || []).map(function (op, oi) {
          var cls = 'opt';
          if (chosen !== undefined) { if (oi === qz.answer) cls += ' right'; else if (oi === chosen) cls += ' wrong'; }
          return '<button class="' + cls + '" data-qi="' + qi + '" data-oi="' + oi + '"><span class="k">' + (oi + 1) + '</span><span>' + inlineRich(op) + '</span></button>';
        }).join('');
        var fb = '';
        if (chosen !== undefined) {
          if (chosen === qz.answer) fb = '<div class="fb ok">✓ 正确。' + (qz.why ? ' ' + inlineRich(qz.why) : '') + '</div>';
          else fb = '<div class="fb no">✗ 再想想。' + (qz.hint ? '提示：' + inlineRich(qz.hint) : '') + ((pr.tries || 0) >= 2 && qz.why ? '<br>解析：' + inlineRich(qz.why) : '') + '</div>';
        }
        return '<div class="qitem"><div class="qtext">Q' + (qi + 1) + '. ' + inlineRich(qz.q) + '</div><div class="opts">' + opts + '</div>' + fb + '</div>';
      }).join('') + '</div>';
    }
    var altHTML = p.alt ? '<div class="card" style="display:' + (pr.showAlt ? 'block' : 'none') + '"><div class="cardlabel">换种讲法</div><div class="prose">' + prose(p.alt) + '</div></div>' : '';
    var deepHTML = p.deep ? '<details><summary>更严格 / 更细节</summary><div class="prose">' + prose(p.deep) + '</div></details>' : '';
    var ok = quizAllCorrect(p) || pr.status === 'learned' || pr.status === 'skipped';
    var mark = pr.status === 'learned' ? '<span class="chip okchip">✓ 已掌握</span>' : (pr.status === 'skipped' ? '<span class="chip warnchip">已跳过</span>' : '');
    $('#stage').innerHTML =
      '<div class="para" data-pid="' + p.id + '">' +
        '<div class="phead"><span class="chip">' + esc(e.ch.num || '') + (e.ch.title ? ' · ' + esc(e.ch.title) : '') + '</span>' +
        '<h2>' + esc(p.title || '') + '</h2>' + mark +
        (p.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') +
        '<span class="spacer"></span><span class="help">第 ' + idx + ' / ' + total() + ' 单元</span></div>' +
        '<div class="card"><div class="cardlabel">原文要点</div><div class="rawbody" data-pid="' + p.id + '">' + sq.html + '</div>' +
          '<div class="paratools"><button class="btn small" data-act="para-annot" data-pid="' + p.id + '">＋ 整段批注</button>' +
          '<button class="btn small" data-act="ask-para" data-pid="' + p.id + '">问 AI</button>' +
          '<button class="btn small" data-act="copy-para" data-pid="' + p.id + '">复制提问</button></div></div>' +
        '<div class="card"><div class="cardlabel">讲解（离线版要点）</div><div class="prose">' + prose(p.explain) + '</div>' + deepHTML + '</div>' +
        altHTML + quizHTML +
        '<div class="gate"><span class="status">' +
          (ok ? '✔ 通过，可以进入下一单元' : (p.quiz && p.quiz.length ? '答对上面的自测才能进入下一单元；有不理解的直接问 AI' : '')) +
          '</span><span class="spacer"></span>' +
          (AI.ready ? '<button class="btn" data-act="ask-gate">还不懂，问 AI</button>' : '') +
          (p.alt ? '<button class="btn" data-act="alt">换种讲法</button>' : '') +
          '<button class="btn" data-act="prev">← 上一段</button>' +
          '<button class="btn primary" data-act="next"' + (ok ? '' : ' disabled') + '>我懂了，继续 →</button>' +
          '<button class="btn small" data-act="skip" title="标记为未掌握并继续">跳过</button></div>' +
      '</div>';
    applyHighlights(p.id);
    renderRail(); renderTOC(); updateProgress();
  }
  function renderBrowse() {
    var html = '', lastCh = -1;
    FLAT.forEach(function (e, i) {
      var p = e.p, sq = sentenceize(p.raw || '', p.id); RAW[p.id] = sq;
      if (e.ci !== lastCh) {
        lastCh = e.ci;
        html += '<div class="para" style="margin-top:28px"><div class="phead"><h2>' + esc((e.ch.num ? e.ch.num + ' ' : '') + e.ch.title) + '</h2></div>' +
          (e.ch.intro ? '<div class="prose help">' + prose(e.ch.intro) + '</div>' : '') + '</div>';
      }
      html += '<div class="para" data-pid="' + p.id + '" id="para-' + p.id + '">' +
        '<div class="phead"><span class="chip">' + (i + 1) + '</span><h2 style="font-size:16px">' + esc(p.title || '') + '</h2>' +
        (p.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<div class="card"><div class="rawbody" data-pid="' + p.id + '">' + sq.html + '</div>' +
        '<div class="paratools"><button class="btn small" data-act="para-annot" data-pid="' + p.id + '">＋ 整段批注</button>' +
        '<button class="btn small" data-act="ask-para" data-pid="' + p.id + '">问 AI</button>' +
        '<button class="btn small" data-act="copy-para" data-pid="' + p.id + '">复制提问</button></div></div>' +
        '<details><summary>离线讲解要点</summary><div class="prose">' + prose(p.explain) + '</div>' +
        (p.deep ? '<details><summary>更严格 / 更细节</summary><div class="prose">' + prose(p.deep) + '</div></details>' : '') + '</details></div>';
    });
    $('#stage').innerHTML = html;
    FLAT.forEach(function (e) { applyHighlights(e.p.id); });
    renderRail(); renderTOC(); updateProgress();
  }
  function render() { if (state.mode === 'browse') renderBrowse(); else renderStudy(); }

  /* ============ 目录 / 进度 ============ */
  function renderTOC() {
    var html = '';
    paper.chapters.forEach(function (ch) {
      html += '<div class="ch"><div class="chh">' + esc((ch.num || '') + ' ' + ch.title) + '</div>';
      ch.paras.forEach(function (p) {
        var i = IDX[p.id], cur = state.mode === 'study' && i === state.cur;
        html += '<a class="p' + (cur ? ' cur' : '') + '" href="#para-' + p.id + '" data-go="' + i + '">' +
          '<span class="dot ' + statusOf(p.id) + '"></span><span class="num">' + (i + 1) + '</span><span>' + esc(p.title || p.id) + '</span></a>';
      });
      html += '</div>';
    });
    $('#toc').innerHTML = html;
  }
  function updateProgress() {
    var n = total(), ok = 0;
    FLAT.forEach(function (e) { if (statusOf(e.p.id) === 'learned') ok++; });
    $('#pbar').style.width = n ? (100 * ok / n) + '%' : '0';
    $('#ptext').textContent = ok + ' / ' + n;
  }

  /* ============ 右侧栏 ============ */
  var railTab = 'ann', railShowAll = false;
  function setRailWidth() { $('#grid').classList.toggle('ai-open', railTab === 'ai'); }
  function renderRail() {
    $$('.rtabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === railTab); });
    $('#rtab-ann').style.display = railTab === 'ann' ? '' : 'none';
    $('#rtab-ai').style.display = railTab === 'ai' ? '' : 'none';
    $('#rtab-ta').style.display = railTab === 'ta' ? '' : 'none';
    setRailWidth();
    if (railTab === 'ann') renderAnnTab();
    else if (railTab === 'ai') renderAI();
    else renderTaTab();
  }
  function annCard(pid, a) {
    return '<div class="anncard" data-aid="' + a.id + '" data-pid="' + pid + '">' +
      (a.quote ? '<div class="quote">' + esc(a.quote.length > 90 ? a.quote.slice(0, 90) + '…' : a.quote) + '</div>' : '') +
      '<div class="note">' + (a.note ? esc(a.note) : '<span class="help">（仅高亮）</span>') + '</div>' +
      '<div class="row">' +
      '<button class="btn small" data-a="ask">问 AI</button>' +
      '<button class="btn small" data-a="deep">深讲</button>' +
      '<button class="btn small" data-a="copy">复制</button>' +
      '<button class="btn small" data-a="edit">编辑</button>' +
      '<button class="btn small" data-a="del">删除</button></div></div>';
  }
  function renderAnnTab() {
    var e = curEntry(); if (!e) return;
    var list = state.ann[e.p.id] || [];
    var html = '<div style="display:flex;gap:6px;margin-bottom:10px">' +
      '<button class="btn small" id="annScope">' + (railShowAll ? '只看本段' : '查看全部') + '</button>' +
      (list.length ? '<button class="btn small" id="annExport">导出</button>' : '') + '</div>';
    if (railShowAll) {
      var all = [];
      Object.keys(state.ann).forEach(function (pid) { (state.ann[pid] || []).forEach(function (a) { all.push({ pid: pid, a: a }); }); });
      all.sort(function (x, y) { return (y.a.ts || 0) - (x.a.ts || 0); });
      html += all.length ? all.map(function (o) {
        var ee = FLAT[IDX[o.pid]];
        return '<div class="help" style="margin-top:6px">§ ' + esc(ee ? (ee.p.title || o.pid) : o.pid) + '</div>' + annCard(o.pid, o.a);
      }).join('') : '<div class="empty">还没有批注。</div>';
    } else {
      html += list.length ? list.map(function (a) { return annCard(e.p.id, a); }).join('')
        : '<div class="empty">本段还没有批注。<br><br>在「原文要点」里选中句子，工具条出现后点「批注」或「高亮」。<br><br>保存后 AI 会自动就这条批注讲解（可在 AI ⚙ 里关掉）。</div>';
    }
    $('#rtab-ann').innerHTML = html;
  }
  function renderTaTab() {
    var e = curEntry(); if (!e) return;
    var p = e.p, html = '<div class="cardlabel">逐句注解（离线速查）</div>';
    if (p.gloss && p.gloss.length) {
      html += p.gloss.map(function (g, i) {
        return '<div class="glossitem" data-gi="' + i + '"><b>' + inlineRich(g.anchor) + '</b>' + prose(g.note) + '</div>';
      }).join('');
    } else html += '<div class="empty">本段暂无预置注解，直接问 AI 更灵活。</div>';
    if (p.faq && p.faq.length) {
      html += '<div class="cardlabel" style="margin-top:16px">常见疑问</div>' + p.faq.map(function (f) {
        return '<details><summary>' + inlineRich(f.q) + '</summary><div class="prose">' + prose(f.a) + '</div></details>';
      }).join('');
    }
    if (p.legend && p.legend.length) {
      html += '<div class="cardlabel" style="margin-top:16px">符号</div><table class="legend">' +
        p.legend.map(function (l) { return '<tr><td class="sym">' + inlineRich(l.sym) + '</td><td>' + inlineRich(l.desc) + '</td></tr>'; }).join('') + '</table>';
    }
    $('#rtab-ta').innerHTML = html;
  }

  /* ================= AI 助教 ================= */
  var API_BASE = (location.protocol === 'file:') ? 'http://127.0.0.1:8788' : '';
  if (location.protocol === 'file:') {
    try { var saved = localStorage.getItem('paper-reader-api-base'); if (saved) API_BASE = saved; } catch (e) {}
  }
  var SYS_RULES = [
    '',
    '回答规则：',
    '1. 用中文；数学用 $...$（行内）和 $$...$$（独立成段），标准 LaTeX，可直接被 KaTeX 渲染。',
    '2. 先给 2-4 句直觉，再给必要推导；推导只保留关键步骤和"为什么能这么走"，不要复述教科书。',
    '3. 精读器会附上【原文】【已有离线讲解】【我的批注】。它们只是上下文：不要照抄已有讲解，要补充新视角、把某一步真正算出来、或指出用户理解里错在哪一步。',
    '4. 如果用户的问题暴露了对某个定义的误解，先纠正定义再回答。',
    '5. 论文没写、属于你的推断，标注「（推断）」；不确定就明确说不确定，不要编造论文的定理编号或数值。',
    '6. 需要例子时给最小可验证的例子（能算数的）；需要代码时给可运行的纯 numpy 片段。',
    '7. 长度克制：默认 200-400 字，除非用户要求展开。'
  ];
  /** 系统提示词按当前读包动态拼接（领域、作者、教学偏好都可配） */
  function buildSYS() {
    var m = paper.meta || {}, a = m.assistant || {};
    var L = ['你是论文精读助教，正在帮助读者逐段吃透《' + (m.title || '') + (m.subtitle ? '——' + m.subtitle : '') + '》。'];
    if (a.persona) L.push(a.persona);
    if (m.tags && m.tags.length) L.push('论文领域：' + m.tags.join('、') + '。');
    var who = [];
    if (m.authors && m.authors.length) who.push(m.authors.join(', '));
    if (m.venue) who.push(m.venue);
    if (m.year) who.push(String(m.year));
    if (who.length) L.push('出处：' + who.join(' · ') + '。');
    if (m.abstract) L.push('论文摘要：' + String(m.abstract).replace(/\n+/g, ' '));
    if (a.hints) L.push('教学偏好：' + a.hints);
    if (a.glossary && a.glossary.length) L.push('领域术语：' + a.glossary.map(function (g) { return g.term + ' = ' + g.def; }).join('；'));
    return L.concat(SYS_RULES).join('\n');
  }
  var AI = {
    checked: false, ready: false, cfg: null, offline: false,
    msgs: [], busy: false, ctrl: null, draft: '', autoAnnot: true,
    ctx: null, thinking: '', nodes: {}
  };
  try { var aa = localStorage.getItem('paper-reader-auto-annot'); if (aa === '0') AI.autoAnnot = false; } catch (e) {}
  function apiURL(p) { return API_BASE + p; }

  function checkAI() {
    AI.checked = false;
    fetch(apiURL('/api/config')).then(function (r) { return r.json(); }).then(function (cfg) {
      AI.cfg = cfg; AI.checked = true; AI.offline = false;
      AI.ready = !!(cfg && cfg.baseUrl);
      if (cfg && cfg.autoAnnot !== undefined) { /* server-side not used */ }
      AI.cfgModel = cfg && cfg.model;
      renderAIDot();
      if (railTab === 'ai') renderAI();
    }).catch(function () {
      AI.checked = true; AI.offline = true; AI.ready = false;
      renderAIDot();
      if (railTab === 'ai') renderAI();
    });
  }
  function renderAIDot() {
    var d = $('#aiDot'); if (!d) return;
    d.className = 'aidot' + (AI.busy ? ' busy' : (AI.ready ? ' on' : ''));
    d.title = AI.ready ? 'AI 已连接：' + (AI.cfgModel || '') : 'AI 未连接';
  }
  function ctxOf(pid, sids, quote, note) {
    var e = FLAT[IDX[pid]] || curEntry(); if (!e) return '';
    var p = e.p, out = [];
    out.push('【论文】' + (paper.meta.title || '') + (paper.meta.subtitle ? '——' + paper.meta.subtitle : '') + (paper.meta.source ? '（' + paper.meta.source + '）' : ''));
    out.push('【当前单元】第' + (e.ch.num || '') + '章 ' + (e.ch.title || '') + ' · ' + (p.title || '') + '（第 ' + ((IDX[pid] || 0) + 1) + '/' + total() + ' 单元）');
    if (p.raw) out.push('【原文】' + String(p.raw).replace(/\$\$/g, ' $ ').replace(/\n+/g, ' '));
    if (p.explain) out.push('【已有离线讲解（仅作参考，不要复述）】' + String(p.explain).replace(/\n+/g, ' '));
    if (p.gloss && p.gloss.length) out.push('【预置逐句注解】' + p.gloss.map(function (g) { return g.anchor + ' → ' + g.note; }).join(' ／ ').replace(/\n+/g, ' '));
    if (quote) out.push('【我划出的原文】' + quote);
    if (note) out.push('【我的批注】' + note);
    return out.join('\n');
  }
  function payload() {
    var out = [{ role: 'system', content: buildSYS() + (AI.cfg && AI.cfg.extraSystem ? '\n\n' + AI.cfg.extraSystem : '') }];
    AI.msgs.slice(-8).forEach(function (m) {
      if (m.err) return;
      out.push({ role: m.role, content: m.role === 'user' && m.ctx ? m.ctx + '\n\n【我的问题】' + m.text : m.text });
    });
    return out;
  }
  function renderAI() {
    var box = $('#rtab-ai');
    if (!box) return;
    if (!AI.checked) { box.innerHTML = '<div class="aempty" style="padding:14px">正在连接本地服务…</div>'; return; }
    if (AI.offline) {
      box.innerHTML = '<div class="aempty" style="padding:12px">' +
        '<div class="offline"><b>AI 助教需要一个本地网关</b><br>浏览器不能安全地持有 API Key，所以由本机的一个小服务转发。启动后刷新本页即可：' +
        '<code>npm start</code>' +
        '（等价于 <code>node server/index.mjs</code>）。启动后打开 <b>http://127.0.0.1:8788/app/</b>；用 file:// 直接打开本页也能连上。' +
        '</div>' +
        '<div class="cardlabel" style="margin-top:12px">临时替代</div>' +
        '点选中文字 →「复制提问」，把问题带到对话里问。' +
        '<div class="mrow" style="margin-top:10px"><button class="btn small" id="aiRetry">重新检测</button></div></div>';
      var rb = $('#aiRetry'); if (rb) rb.onclick = checkAI;
      return;
    }
    var e = curEntry() || { p: {}, ch: {} };
    var chips = '<span class="chipx"><b>上下文</b> 第' + (state.cur + 1) + '单元 · ' + esc((e.p.title || '').slice(0, 22)) + '</span>';
    if (AI.ctx && AI.ctx.quote) chips += '<span class="chipx"><b>选句</b> ' + esc(String(AI.ctx.quote).slice(0, 26)) + '…</span>';
    if (AI.ctx && AI.ctx.note) chips += '<span class="chipx"><b>批注</b> ' + esc(String(AI.ctx.note).slice(0, 26)) + '…</span>';
    var msgsHTML = AI.msgs.length ? '' : '<div class="aempty">对着这一段问任何问题：为什么这一步成立、这个假设去掉会怎样、举个能算的例子、我这样理解对不对。<br><br>选中原文后点「批注 / 问 AI」，问题会自动带上选句与批注。' +
      '<br><br>快捷键：在此输入框里 <kbd>Ctrl</kbd>+<kbd>Enter</kbd> 发送。</div>';
    box.innerHTML =
      '<div class="aitop"><span class="who">' + (AI.ready ? '模型：<b>' + esc(AI.cfgModel || '') + '</b>' : '未配置模型') + '</span>' +
      '<span class="spacer" style="flex:1"></span>' +
      '<button class="btn small" id="aiClear">清空对话</button>' +
      '<button class="btn small" id="aiCfg">设置</button></div>' +
      '<div class="aictx">' + chips + '</div>' +
      '<div class="amsgs" id="aiMsgs">' + msgsHTML + '</div>' +
      '<div class="aquick">' +
      '<button class="btn small" data-q="unit">讲这一单元</button>' +
      '<button class="btn small" data-q="step">把关键一步算出来</button>' +
      '<button class="btn small" data-q="why">为什么需要这个条件</button>' +
      '<button class="btn small" data-q="example">举个能算的例子</button>' +
      '<button class="btn small" data-q="check">检查我的理解</button>' +
      (AI.busy ? '<button class="btn small" id="aiStop">停止</button>' : '') +
      '</div>' +
      '<div class="ainput"><textarea id="aiInput" placeholder="问 AI：这段在说什么？为什么 ≥ 成立？如果去掉预承诺会怎样？（Ctrl+Enter 发送）"></textarea>' +
      '<button class="btn primary" id="aiSend">' + (AI.busy ? '…' : '发送') + '</button></div>';
    AI.nodes.msgs = $('#aiMsgs');
    var ta = $('#aiInput');
    ta.value = AI.draft || '';
    ta.addEventListener('input', function () { AI.draft = ta.value; });
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); sendFromInput(); }
    });
    $('#aiSend').onclick = sendFromInput;
    $('#aiClear').onclick = function () { AI.msgs = []; AI.ctx = null; renderAI(); };
    $('#aiCfg').onclick = openCfg;
    var st = $('#aiStop'); if (st) st.onclick = stopAI;
    $$('.aquick [data-q]').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.q;
        var qmap = {
          unit: '请完整讲解当前单元：先直觉，再关键推导，最后指出最容易误解的一点。',
          step: '把这一单元里最关键的一步（或最难的一步）真正算出来，写出中间代数。',
          why: '这个条件 / 假设在证明里起什么作用？如果去掉，结论会在哪里崩掉？给个反例。',
          example: '给一个最小的、能算数的例子来验证本单元的核心结论。',
          check: '我划出/批注的地方，我的理解是：请判断它对不对，错在哪一步。'
        };
        askAI(qmap[k] || k, AI.ctx);
      };
    });
    renderAIMsgs();
  }
  function renderAIMsgs() {
    var box = $('#aiMsgs'); if (!box) return;
    if (!AI.msgs.length) return;
    box.innerHTML = AI.msgs.map(function (m, i) {
      var role = m.role === 'user' ? '我' : 'AI 助教';
      var cls = 'msg ' + (m.role === 'user' ? 'user' : 'assist') + (m.err ? ' err' : '');
      var body = m.role === 'user' ? esc(m.text) : (m.text ? md(m.text) : (m.streaming ? '<span class="athink">思考中…' + (AI.thinking ? '（推理 ' + AI.thinking.length + ' 字）' : '') + '</span>' : ''));
      if (m.streaming && m.text) body += '<span class="cursor"></span>';
      var tools = (m.role === 'assistant' && !m.streaming && m.text) ?
        '<div class="mtools"><button class="btn small" data-m="copy" data-mi="' + i + '">复制</button>' +
        '<button class="btn small" data-m="note" data-mi="' + i + '">存为批注</button></div>' : '';
      return '<div class="' + cls + '" data-mi="' + i + '"><div class="mrole">' + role + '</div><div class="mbody">' + body + '</div>' + tools + '</div>';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }
  function lastAssist() { return AI.msgs.length ? AI.msgs[AI.msgs.length - 1] : null; }
  var rafPending = false;
  function streamTick() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      var m = lastAssist();
      if (!m || m.role !== 'assistant') return;
      var box = $('#aiMsgs'); if (!box) return;
      var el = box.querySelector('[data-mi="' + (AI.msgs.length - 1) + '"] .mbody');
      if (el) {
        el.innerHTML = md(m.text) + (m.streaming ? '<span class="cursor"></span>' : '');
        box.scrollTop = box.scrollHeight;
      }
    });
  }
  function sendFromInput() {
    var ta = $('#aiInput'); if (!ta) return;
    var v = ta.value.trim();
    if (!v) { toast('先写点什么'); return; }
    ta.value = ''; AI.draft = '';
    askAI(v, AI.ctx);
  }
  function stopAI() { if (AI.ctrl) { try { AI.ctrl.abort(); } catch (e) {} } }

  function askAI(text, extra) {
    if (!AI.ready) { toast('AI 未连接：点右上角 AI ⚙ 配置，或启动本地服务'); railTab = 'ai'; renderRail(); return; }
    if (AI.busy) { toast('正在回答，先等它说完（或点停止）'); return; }
    var pid = (extra && extra.pid) || (curEntry() || {}).p.id;
    AI.ctx = extra || { pid: pid };
    var ctx = ctxOf(pid, extra && extra.sids, extra && extra.quote, extra && extra.note);
    AI.msgs.push({ role: 'user', text: text, ctx: ctx, ts: Date.now() });
    AI.msgs.push({ role: 'assistant', text: '', streaming: true, ts: Date.now() });
    AI.busy = true;
    if (railTab !== 'ai') { railTab = 'ai'; }
    renderRail();
    renderAIDot();
    runStream();
  }
  function runStream() {
    AI.ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var m = lastAssist();
    fetch(apiURL('/api/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: payload(), stream: true }),
      signal: AI.ctrl ? AI.ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || ('HTTP ' + res.status));
        });
      }
      var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            var rawChunk = buf.slice(0, i); buf = buf.slice(i + 2);
            var line = rawChunk.split('\n').filter(function (l) { return l.indexOf('data:') === 0; })
              .map(function (l) { return l.slice(5).trim(); }).join('');
            if (!line) continue;
            var o; try { o = JSON.parse(line); } catch (e) { continue; }
            if (o.error) throw new Error(o.error);
            if (o.d) { m.text += o.d; streamTick(); }
            if (o.r) { AI.thinking += o.r; streamTick(); }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (err && err.name === 'AbortError') { m.text += '\n\n（已停止）'; }
      else { m.err = true; m.text = '请求失败：' + (err && err.message ? err.message : err) + '\n\n检查：本地服务是否在运行、API Key 是否有效、模型名是否存在于该服务商。点「设置」可测试连接。'; }
    }).then(function () {
      m.streaming = false; AI.busy = false; AI.ctrl = null;
      renderAIDot(); renderRail();
    });
  }

  /* ============ AI 设置 ============ */
  function openCfg() {
    var c = AI.cfg || {};
    var sel = $('#cfgPreset');
    sel.innerHTML = '<option value="">自定义…</option>' + ((c.presets || []).map(function (p) {
      return '<option value="' + p.id + '">' + p.label + '</option>';
    }).join(''));
    $('#cfgBase').value = c.baseUrl || '';
    $('#cfgKey').value = '';
    $('#cfgKey').placeholder = c.hasKey ? ('已保存：' + (c.keyMask || '') + '（留空则不变）') : 'sk-...（只存在本机 config.local.json）';
    $('#cfgModel').value = c.model || '';
    $('#cfgTemp').value = (c.temperature !== undefined ? c.temperature : 0.3);
    $('#cfgAuto').checked = !!AI.autoAnnot;
    $('#cfgStatus').innerHTML = (c.configured ? '<span class="badge ok">已配置</span>' : '<span class="badge no">未配置</span>') +
      (c.baseUrl ? ' <span class="help">' + esc(c.baseUrl) + '</span>' : '');
    $('#cfgModels').textContent = '';
    $('#cfg').style.display = 'block';
    sel.onchange = function () {
      var p = (c.presets || []).filter(function (x) { return x.id === sel.value; })[0];
      if (p) { $('#cfgBase').value = p.baseUrl; $('#cfgModel').value = p.model; }
    };
    $('#cfgClose').onclick = function () { $('#cfg').style.display = 'none'; };
    $('#cfgTest').onclick = function () {
      $('#cfgModels').textContent = '测试中…';
      fetch(apiURL('/api/models')).then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) {
          $('#cfgModels').innerHTML = '<span class="badge ok">连接成功</span> ' + (j.models ? '可用模型：' + esc(j.models.slice(0, 12).join('、')) : '');
        } else {
          $('#cfgModels').innerHTML = '<span class="badge no">失败</span> ' + esc(j.error || j.detail || ('HTTP ' + j.status));
        }
      }).catch(function (e) { $('#cfgModels').textContent = '测试失败：' + e.message + '（本地服务是否在运行？）'; });
    };
    $('#cfgSave').onclick = function () {
      var body = {
        baseUrl: $('#cfgBase').value.trim(),
        model: $('#cfgModel').value.trim(),
        temperature: Number($('#cfgTemp').value || 0.3)
      };
      if ($('#cfgKey').value.trim()) body.apiKey = $('#cfgKey').value.trim();
      AI.autoAnnot = $('#cfgAuto').checked;
      try { localStorage.setItem('paper-reader-auto-annot', AI.autoAnnot ? '1' : '0'); } catch (e) {}
      fetch(apiURL('/api/config'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function () { $('#cfg').style.display = 'none'; toast('已保存，开始使用'); checkAI(); })
        .catch(function (e) { toast('保存失败：' + e.message); });
    };
  }

  /* ============ 交互 ============ */
  var pendingSel = null, popSent = null;
  function sidRangeInStage(sel) {
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0), stage = $('#stage');
    if (!stage.contains(range.commonAncestorContainer)) return null;
    var node = range.startContainer, box = null;
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== stage) { if (el.classList && el.classList.contains('rawbody')) { box = el; break; } el = el.parentElement; }
    if (!box) return null;
    var pid = box.dataset.pid; if (!pid) return null;
    var sids = [];
    $$('.sent[data-pid="' + pid + '"]', box).forEach(function (s) { try { if (range.intersectsNode(s)) sids.push(s.dataset.sid); } catch (e) {} });
    if (!sids.length) return null;
    var sq = RAW[pid];
    var quote = sq ? sids.map(function (s) { return (sq.bySid[s] || {}).raw || ''; }).join('').replace(/\n+/g, ' ') : sel.toString();
    return { pid: pid, sids: sids, quote: quote, rect: range.getBoundingClientRect() };
  }
  function setMode(m) {
    state.mode = m; save();
    $$('#modeseg button').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
    render();
  }
  function go(i) {
    state.cur = Math.max(0, Math.min(total() - 1, i)); save();
    if (state.mode !== 'study') { state.mode = 'study'; $$('#modeseg button').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === 'study'); }); }
    render(); $('#stage').scrollTop = 0;
  }
  function choose(qi, oi) {
    var e = curEntry(); if (!e) return;
    var p = e.p, pr = progOf(p.id);
    if (!p.quiz || !p.quiz[qi]) return;
    if (pr.answers[qi] === p.quiz[qi].answer) return;
    var top = $('#stage').scrollTop;
    pr.answers[qi] = oi; pr.tries = (pr.tries || 0) + 1; save();
    render(); $('#stage').scrollTop = top;
  }
  function nextPara(silent) {
    var e = curEntry(); if (!e) return;
    var pr = progOf(e.p.id);
    if (!quizAllCorrect(e.p) && pr.status !== 'skipped') {
      if (!silent) { toast('先答对自测题；或点「跳过」标记未掌握；也可以直接问 AI'); return; }
    }
    if (pr.status !== 'learned' && pr.status !== 'skipped') pr.status = 'learned';
    save();
    if (state.cur + 1 < total()) { state.cur += 1; save(); render(); $('#stage').scrollTop = 0; }
    else { toast('已经是最后一个单元了 🎉'); render(); }
  }

  /* ============ 导出 / 帮助 ============ */
  function exportNotes() {
    var m = paper.meta || {};
    var lines = ['# ' + (m.title || '论文') + ' · 精读笔记', ''];
    if (m.subtitle) lines.push('> ' + m.subtitle, '');
    if (m.source) lines.push('来源：' + m.source);
    if (m.authors && m.authors.length) lines.push('作者：' + m.authors.join(', '));
    lines.push('导出时间：' + new Date().toLocaleString(), '');
    var learned = [], skipped = [];
    FLAT.forEach(function (e) { var s = statusOf(e.p.id); if (s === 'learned') learned.push(e); if (s === 'skipped') skipped.push(e); });
    lines.push('## 进度', '', '- 学习单元总数：' + total(), '- 已掌握：' + learned.length, '- 跳过：' + skipped.length, '');
    if (learned.length) lines.push('已掌握：' + learned.map(function (e) { return e.p.title; }).join('；'), '');
    var any = 0;
    FLAT.forEach(function (e) {
      var list = state.ann[e.p.id] || [];
      if (!list.length) return; any++;
      lines.push('## ' + (e.ch.num ? e.ch.num + ' ' : '') + e.ch.title + ' · ' + (e.p.title || e.p.id), '');
      list.forEach(function (a) {
        if (a.quote) lines.push('> ' + a.quote);
        if (a.note) lines.push('', a.note);
        lines.push('');
      });
    });
    if (!any) lines.push('（还没有批注）');
    if (AI.msgs.length) {
      lines.push('', '## 与 AI 助教的问答', '');
      AI.msgs.forEach(function (m) {
        lines.push('**' + (m.role === 'user' ? '我' : 'AI') + '**：' + (m.text || '').trim(), '');
      });
    }
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = (m.id || 'paper') + '-精读笔记.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('已导出 Markdown');
  }
  function helpInfo() {
    openInfo('怎么用这个精读器', '',
      '<p><strong>逐段学习</strong>：一次一个单元——原文 → 离线讲解 → 自测。答对自测才放行；有疑问直接问右侧 AI 助教（它能看到本段原文与你的批注）。</p>' +
      '<p><strong>批注驱动 AI</strong>：选中句子 → 「批注」写完保存，AI 会自动就这条批注讲解。也可以点「问 AI」立刻追问；选中文字工具条里也有「问 AI」。</p>' +
      '<p><strong>AI 助教</strong>：右侧第三个页签。上下文（当前单元 + 选句 + 批注）自动附带；回答流式输出，可复制或一键存为批注。</p>' +
      '<p><strong>连接模型</strong>：点右上角 <b>AI ⚙</b>，选服务商预设、填 Base URL / API Key / 模型名，测试连接后保存。Key 只存在本机 <code>config.local.json</code>，不经过浏览器。</p>' +
      '<p><strong>快捷键</strong>：← / → 切换单元；1–9 选自测；Esc 关弹窗；AI 输入框里 Ctrl+Enter 发送。</p>');
  }

  /* ============ 事件 ============ */
  function bind() {
    // 点击空白处收气泡
    document.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('#pop')) return;
      hidePop();
      if (e.target.id === 'modal') closeModal();
      if (e.target.id === 'cfg') $('#cfg').style.display = 'none';
    });
    $('#mSave').addEventListener('click', function () { if (modalSave) modalSave($('#mNote').value); closeModal(); });
    $('#mCancel').addEventListener('click', closeModal);
    $('#mNote').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.ctrlKey) { if (modalSave) modalSave($('#mNote').value); closeModal(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape') { hidePop(); closeModal(); $('#cfg').style.display = 'none'; return; }
      if (e.key === 'ArrowRight') { nextPara(); return; }
      if (e.key === 'ArrowLeft') { if (state.cur > 0) go(state.cur - 1); return; }
      if (/^[1-9]$/.test(e.key) && state.mode === 'study') {
        var e2 = curEntry(); if (!e2 || !e2.p.quiz) return;
        var pr = progOf(e2.p.id);
        for (var qi = 0; qi < e2.p.quiz.length; qi++) {
          if (pr.answers[qi] === undefined) { choose(qi, parseInt(e.key, 10) - 1); return; }
        }
      }
    });
    // 选中文字 → 工具条
    document.addEventListener('mouseup', function (e) {
      if (e.target.closest && (e.target.closest('#pop') || e.target.closest('#modal') || e.target.closest('#cfg'))) return;
      var info = sidRangeInStage(window.getSelection());
      if (!info) return;
      pendingSel = info;
      var hasAI = AI.ready;
      showPop(info.rect,
        '<div class="ptitle">已选中 ' + info.sids.length + ' 句</div>' +
        '<div class="pbody" style="font-family:var(--serif)">' + esc(info.quote.slice(0, 150)) + (info.quote.length > 150 ? '…' : '') + '</div>' +
        '<div class="prow">' +
        (hasAI ? '<button class="btn small primary" data-p="askai">问 AI</button>' : '') +
        '<button class="btn small" data-p="note">批注</button>' +
        '<button class="btn small" data-p="hl">高亮</button>' +
        '<button class="btn small" data-p="copy">复制</button></div>');
    });
    // 舞台内点击
    $('#stage').addEventListener('click', function (e) {
      var t = e.target;
      var goEl = t.closest ? t.closest('[data-go]') : null;
      if (goEl) {
        e.preventDefault();
        var gi = parseInt(goEl.dataset.go, 10);
        if (state.mode === 'browse') { var el = $('#para-' + FLAT[gi].p.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else go(gi);
        return;
      }
      var actEl = t.closest ? t.closest('[data-act]') : null;
      if (actEl) {
        var act = actEl.dataset.act, pid = actEl.dataset.pid, e3 = curEntry();
        if (act === 'next') { nextPara(); return; }
        if (act === 'prev') { if (state.cur > 0) go(state.cur - 1); return; }
        if (act === 'alt') { progOf(e3.p.id).showAlt = true; save(); render(); return; }
        if (act === 'skip') { progOf(e3.p.id).status = 'skipped'; save(); toast('已标记为未掌握'); nextPara(true); return; }
        if (act === 'ask-para') {
          var sq0 = RAW[pid], rawTxt = sq0 ? sq0.sents.map(function (s) { return s.raw; }).join('') : '';
          askAI('请讲解这一单元：先给直觉，再给关键推导，最后指出最容易误解的一点。', { pid: pid, quote: rawTxt.slice(0, 1200) });
          return;
        }
        if (act === 'ask-gate') {
          railTab = 'ai'; renderRail();
          setTimeout(function () {
            var ta = $('#aiInput'); if (ta) { ta.value = '我还没完全懂这一单元，请换一种方式讲，并指出我最可能卡住的地方。'; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
          }, 60);
          return;
        }
        if (act === 'para-annot') {
          openModal('整段批注', (FLAT[IDX[pid]] || {}).p ? FLAT[IDX[pid]].p.title : '', '', function (txt) {
            if (txt && txt.trim()) addAnnot(pid, [], '（整段）', txt);
          });
          return;
        }
        if (act === 'copy-para') { copyText(promptText(pid, '', '')); return; }
      }
      if (t.dataset && t.dataset.qi !== undefined) { choose(parseInt(t.dataset.qi, 10), parseInt(t.dataset.oi, 10)); return; }
      var sent = t.closest ? t.closest('.sent') : null;
      if (sent && (sent.classList.contains('hl') || sent.classList.contains('has-gloss'))) {
        var pid2 = sent.dataset.pid, sid = sent.dataset.sid;
        popSent = { pid: pid2, sid: sid, rect: sent.getBoundingClientRect() };
        var anns = (state.ann[pid2] || []).filter(function (a) { return (a.sids || []).indexOf(sid) >= 0; });
        var gnote = glossSentenceMap(pid2)[sid] ? deepFor(pid2, [sid]) : null;
        var html = '';
        if (gnote) html += '<div class="ptitle">预置注解</div><div class="pbody">' + prose(gnote) + '</div>';
        anns.forEach(function (a) {
          html += '<div style="margin-top:8px"><div class="ptitle">我的批注</div><div class="pbody" style="white-space:pre-wrap">' + esc(a.note || '（仅高亮）') +
            '</div><div class="prow"><button class="btn small" data-e="ask" data-aid="' + a.id + '">问 AI</button>' +
            '<button class="btn small" data-e="edit" data-aid="' + a.id + '">编辑</button>' +
            '<button class="btn small" data-e="del" data-aid="' + a.id + '">删除</button></div></div>';
        });
        html += '<div class="prow"><button class="btn small" data-e="new">＋ 批注这句</button></div>';
        showPop(popSent.rect, html);
        return;
      }
      var gi2 = t.closest ? t.closest('[data-gi]') : null;
      if (gi2) {
        var e4 = curEntry(); if (!e4 || !e4.p.gloss) return;
        var g = e4.p.gloss[parseInt(gi2.dataset.gi, 10)]; if (!g) return;
        var anchor = String(g.anchor || '').replace(/\s+/g, '');
        var sq = RAW[e4.p.id], found = null;
        if (sq) sq.sents.forEach(function (s) { if (!found && s.plain.replace(/\s+/g, '').indexOf(anchor) >= 0) found = s; });
        if (found) {
          var el2 = $('.sent[data-pid="' + e4.p.id + '"][data-sid="' + found.sid + '"]');
          if (el2) { el2.scrollIntoView({ block: 'center', behavior: 'smooth' }); el2.classList.add('flash'); setTimeout(function () { el2.classList.remove('flash'); }, 2000); }
        }
        return;
      }
      if (t.id === 'annScope') { railShowAll = !railShowAll; renderAnnTab(); return; }
      if (t.id === 'annExport') { exportNotes(); return; }
      var ab = t.closest ? t.closest('[data-a]') : null;
      if (ab) {
        var card = ab.closest('.anncard'); if (!card) return;
        var pid3 = card.dataset.pid, a2 = findAnn(pid3, card.dataset.aid), kind = ab.dataset.a;
        if (kind === 'ask') {
          askAI('请针对我这条批注讲解：' + (a2 && a2.note ? a2.note : '（仅高亮，请解释我划出的这句）'),
            { pid: pid3, sids: a2 ? a2.sids : [], quote: a2 ? a2.quote : '', note: a2 ? a2.note : '' });
        } else if (kind === 'deep') {
          if (AI.ready) {
            askAI('请着重讲解我划出的这段，以及它在这个论证里的作用。', { pid: pid3, sids: a2 ? a2.sids : [], quote: a2 ? a2.quote : '', note: a2 ? a2.note : '' });
          } else {
            var dd = deepFor(pid3, a2 ? a2.sids : []);
            if (dd) openInfo('着重讲解（离线）', a2 ? a2.quote : '', prose(dd));
            else copyText(promptText(pid3, a2 ? a2.quote : '', a2 ? a2.note : ''));
          }
        } else if (kind === 'copy') copyText(promptText(pid3, a2 ? a2.quote : '', a2 ? a2.note : ''));
        else if (kind === 'edit') editAnnot(pid3, card.dataset.aid);
        else if (kind === 'del') delAnnot(pid3, card.dataset.aid);
        return;
      }
      var tab = t.closest ? t.closest('[data-tab]') : null;
      if (tab) { railTab = tab.dataset.tab; renderRail(); return; }
      if (t.id === 'aiRetry') { checkAI(); return; }
      // AI 消息工具
      var mb = t.closest ? t.closest('[data-m]') : null;
      if (mb) {
        var mi = parseInt(mb.dataset.mi, 10), msg = AI.msgs[mi]; if (!msg) return;
        if (mb.dataset.m === 'copy') copyText(msg.text);
        if (mb.dataset.m === 'note') {
          var pidx = (AI.ctx && AI.ctx.pid) || (curEntry() || {}).p.id;
          addAnnot(pidx, (AI.ctx && AI.ctx.sids) || [], (AI.ctx && AI.ctx.quote) || '（AI 讲解）', msg.text.slice(0, 4000));
        }
        return;
      }
    });
    // 气泡内按钮
    document.addEventListener('click', function (e) {
      var t = e.target;
      var pbtn = t.closest ? t.closest('#pop [data-p]') : null;
      if (pbtn && pendingSel) {
        var act = pbtn.dataset.p, info = pendingSel;
        if (act === 'hl') { addAnnot(info.pid, info.sids, info.quote, ''); hidePop(); return; }
        if (act === 'note') { hidePop(); openModal('批注', info.quote, '', function (txt) { addAnnot(info.pid, info.sids, info.quote, txt); }); return; }
        if (act === 'copy') { copyText(promptText(info.pid, info.quote, '')); hidePop(); return; }
        if (act === 'askai') { hidePop(); askAI('请讲解我划出的这段原文，并指出它在论证里的作用；如果有常见误解也点出来。', { pid: info.pid, sids: info.sids, quote: info.quote }); return; }
        return;
      }
      var ebtn = t.closest ? t.closest('#pop [data-e]') : null;
      if (ebtn) {
        var pid4 = popSent ? popSent.pid : (curEntry() || {}).p.id;
        var ev = ebtn.dataset.e;
        if (ev === 'new') {
          hidePop();
          var q = popSent && RAW[pid4] && RAW[pid4].bySid[popSent.sid] ? RAW[pid4].bySid[popSent.sid].raw : '';
          openModal('批注这一句', q, '', function (txt) { addAnnot(pid4, popSent ? [popSent.sid] : [], q, txt); });
        } else if (ev === 'ask') {
          var a5 = findAnn(pid4, ebtn.dataset.aid);
          hidePop();
          askAI('请针对我这条批注讲解：' + (a5 && a5.note ? a5.note : '（仅高亮）'), { pid: pid4, sids: a5 ? a5.sids : [], quote: a5 ? a5.quote : '', note: a5 ? a5.note : '' });
        } else if (ev === 'edit') { hidePop(); editAnnot(pid4, ebtn.dataset.aid); }
        else if (ev === 'del') delAnnot(pid4, ebtn.dataset.aid);
        return;
      }
    });
    $$('#modeseg button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
    $('#btnExport').addEventListener('click', exportNotes);
    $('#btnHelp').addEventListener('click', helpInfo);
    $('#btnAI').addEventListener('click', function () { railTab = 'ai'; renderRail(); openCfg(); });
    $('#btnTheme').addEventListener('click', function () {
      state.st.theme = state.st.theme === 'dark' ? 'light' : 'dark';
      document.body.classList.toggle('dark', state.st.theme === 'dark'); save();
    });
    $('#btnFontUp').addEventListener('click', function () { state.st.font = Math.min(22, state.st.font + 1); applyFont(); save(); });
    $('#btnFontDown').addEventListener('click', function () { state.st.font = Math.max(14, state.st.font - 1); applyFont(); save(); });
  }

  /* ============ 启动 ============ */
  load();

  /* 读包选择器 + 恢复上次阅读位置 */
  var NO_PACKS = false;

  /** 零读包时的引导页：本仓库不带任何论文内容，用户必须自己建读包 */
  function renderOnboarding() {
    var stage = $('#stage'), toc = $('#toc');
    document.title = '论文精读器 · 先建一个读包';
    var t0 = $('#paperTitle'); if (t0) t0.textContent = '论文精读器';
    var s0 = $('#srcline'); if (s0) s0.textContent = '空仓库 · 这个页面等着你的第一个读包';
    if (toc) {
      toc.innerHTML =
        '<div style="padding:14px 16px 4px;font-size:.72rem;letter-spacing:.08em;color:var(--muted)">开始</div>' +
        '<ol style="margin:0;padding:0 16px 16px 30px;font-size:.86rem;line-height:1.9;color:var(--ink)">' +
        '<li>建一个读包</li><li>写单元内容</li><li>构建 + 打开</li></ol>';
    }
    if (!stage) return;
    var code = 'npm run new -- --id mypaper --title "我的论文"';
    var code2 = 'npm run import -- --input paper.pdf --id mypaper --title "我的论文"';
    stage.innerHTML =
      '<div class="para" data-pid="__onboard__">' +
      '<div class="phead"><span class="chip">空仓库</span><h2>还没有读包 —— 这个仓库只带机制，不带论文内容</h2></div>' +
      '<div class="card"><div class="cardlabel">第 1 步：建读包</div>' +
      '<div class="rawbody"><p>二选一：从零写，或从 PDF / Markdown 导入。</p>' +
      '<pre style="overflow:auto;background:var(--codebg,#f3f4f6);padding:10px 12px;border-radius:8px;font-size:.82rem;line-height:1.7">' +
      esc(code) + '\n' + esc(code2) + '</pre></div></div>' +
      '<div class="card"><div class="cardlabel">第 2 步：写内容</div>' +
      '<div class="rawbody"><p>编辑 <code>content/mypaper/01_body.js</code>：<code>raw</code> 放原文要点，<code>explain</code> 放你的讲解，' +
      '<code>gloss</code> 写逐句注解，<code>quiz</code> 出自测（答对才放行）。公式用 <code>$...$</code>，KaTeX 严格校验。</p>' +
      '<p>完整字段表见 <code>docs/CONTENT_FORMAT.md</code>，骨架见 <code>content/_template/</code>。</p></div></div>' +
      '<div class="card"><div class="cardlabel">第 3 步：构建并打开</div>' +
      '<div class="rawbody"><pre style="overflow:auto;background:var(--codebg,#f3f4f6);padding:10px 12px;border-radius:8px;font-size:.82rem">' +
      esc('npm run build\nnpm start      # http://127.0.0.1:8788/app/') + '</pre>' +
      '<p style="color:var(--muted);font-size:.82rem">读包默认<b>不进版本库</b>（<code>.gitignore</code> 只放行 <code>content/_template/</code>），避免把别人的论文原文推上公网。</p>' +
      '</div></div></div>';
  }

  (function initPapers() {
    if (!HAS_PACKS) { NO_PACKS = true; renderOnboarding(); return; }
    var sel = $('#paperSel');
    if (sel && PAPERS.length) {
      sel.innerHTML = PAPERS.map(function (p) {
        return '<option value="' + esc(p.meta.id) + '">' + esc(p.meta.title || p.meta.id) + '</option>';
      }).join('');
      sel.addEventListener('change', function () { switchPaper(sel.value); });
      if (PAPERS.length === 1) sel.style.display = 'none';
    }
    var want = (state.paper && paperById(state.paper)) ? state.paper : PAPERS[0].meta.id;
    setPaper(want);
    if (sel) sel.value = paper.meta.id;
    var t = $('#paperTitle'); if (t) t.textContent = paper.meta.title || '';
    var s3 = $('#srcline'); if (s3) s3.textContent = paper.meta.source || '';
    document.title = (paper.meta.title || '论文精读器') + ' · 精读器';
  })();

  if (NO_PACKS) return;
  if (!FLAT.length) {
    $('#stage').innerHTML = '<p class="empty">这个读包还没有内容：往 content/&lt;id&gt;/ 里加单元，然后 <code>npm run build</code>。</p>';
    return;
  }
  state.cur = Math.max(0, Math.min(total() - 1, state.cur || 0));
  document.body.classList.toggle('dark', state.st.theme === 'dark');
  applyFont();
  $$('#modeseg button').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === state.mode); });
  bind();
  render();
  checkAI();
})();
