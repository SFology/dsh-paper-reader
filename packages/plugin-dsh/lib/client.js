/*
 * 浏览器半（client plugin）—— DSH Web GUI 侧。
 *
 * 契约（来自 @deepseek-ai/dsh-client-modules 的 lazy-CJS 模块系统）：
 *   - 本文件是普通副作用脚本，由 /plugins/<包名>/client.js 送到页面；
 *   - 不能有顶层 ESM import/export；react 等平台模块由 factory 的 require 取；
 *   - 执行时只注册 factory；真正逻辑等首次 materialize 时在 factory 里跑；
 *   - factory(require) 直接返回 Cordis 插件对象 { name, inject, apply }。
 *
 * 提供两个扩展点：
 *   shell.overlay     右下角「精读器」浮层：iframe 内嵌本地精读器 + 批注桥
 *   settings.section  设置页：服务地址、连通状态、内嵌开关
 */
;(function () {
  'use strict'

  var PACKAGE_ID = 'dsh-plugin-paper-reader'
  var DEFAULT_URL = 'http://127.0.0.1:8788/app/'
  var LS_URL = 'dsh-paper-reader:url'
  var LS_EMBED = 'dsh-paper-reader:embed'

  window.__ModuleLoader__.load({ id: PACKAGE_ID, factory: factory })

  function factory(require) {
    var React = require('react')
    var jsxRuntime = require('react/jsx-runtime')
    var h = jsxRuntime.jsx
    var Fragment = jsxRuntime.Fragment

    var ctxRef = null

    /* ---------------- 配置（localStorage，仅本机） ---------------- */
    function readUrl() {
      try { return localStorage.getItem(LS_URL) || DEFAULT_URL } catch (e) { return DEFAULT_URL }
    }
    function writeUrl(u) {
      try { localStorage.setItem(LS_URL, u) } catch (e) { /* 忽略 */ }
    }
    function readEmbed() {
      try { return localStorage.getItem(LS_EMBED) !== '0' } catch (e) { return true }
    }
    function writeEmbed(v) {
      try { localStorage.setItem(LS_EMBED, v ? '1' : '0') } catch (e) { /* 忽略 */ }
    }

    /* ---------------- 把批注交给当前会话 ---------------- */
    async function sendToAgent(text) {
      var question = String(text || '').trim()
      if (!question) return { ok: false, how: 'empty' }
      // 路径 A：remote.commands.execute(sessionId, text, [])
      try {
        var remote = ctxRef && ctxRef.get && ctxRef.get('remote')
        var commands = remote && remote.commands
        if (commands && typeof commands.execute === 'function') {
          var sid = currentSessionId()
          if (sid) {
            await commands.execute(sid, question, [])
            return { ok: true, how: 'session' }
          }
        }
      } catch (e) { /* 落到 B */ }
      // 路径 B：剪贴板兜底
      try {
        await navigator.clipboard.writeText(question)
        return { ok: true, how: 'clipboard' }
      } catch (e) {
        return { ok: false, how: 'failed', error: e && e.message ? e.message : String(e) }
      }
    }

    function currentSessionId() {
      try {
        var ws = ctxRef && ctxRef.get && ctxRef.get('uiWorkspace')
        var id = ws && (ws.currentSessionId || (ws.session && ws.session.id))
        return typeof id === 'string' ? id : ''
      } catch (e) { return '' }
    }

    /* ---------------- 样式（一次注入，随 overlay 存在） ---------------- */
    function injectStyle() {
      if (document.getElementById('dsh-paper-reader-style')) return
      var css = [
        '.dpr-fab{position:fixed;right:18px;bottom:18px;z-index:2147482000;display:flex;align-items:center;gap:6px;',
        'padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);cursor:pointer;',
        'background:rgba(24,24,28,.92);color:#eee;font:12px/1 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.32)}',
        '.dpr-fab:hover{background:rgba(40,40,48,.96)}',
        '.dpr-dot{width:7px;height:7px;border-radius:50%;background:#888}',
        '.dpr-dot.on{background:#3ecf8e}.dpr-dot.off{background:#e5484d}',
        '.dpr-panel{position:fixed;right:16px;bottom:64px;z-index:2147482001;width:min(920px,86vw);height:min(76vh,860px);',
        'display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:#16161a;color:#eee;',
        'border:1px solid rgba(255,255,255,.14);box-shadow:0 20px 60px rgba(0,0,0,.5)}',
        '.dpr-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1d1d22;font:12px/1.4 system-ui,sans-serif}',
        '.dpr-head b{font-weight:600}.dpr-head .sp{flex:1}',
        '.dpr-btn{border:1px solid rgba(255,255,255,.16);background:#26262c;color:#eee;border-radius:6px;padding:3px 8px;cursor:pointer;font:11px/1.4 system-ui,sans-serif}',
        '.dpr-btn:hover{background:#32323a}',
        '.dpr-body{flex:1;position:relative;background:#0f0f12}',
        '.dpr-body iframe{width:100%;height:100%;border:0;background:#fff}',
        '.dpr-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;',
        'color:#bbb;font:13px/1.7 system-ui,sans-serif;text-align:center;padding:24px}',
        '.dpr-empty code{background:#26262c;padding:2px 6px;border-radius:4px;font-size:12px}',
        '.dpr-note{position:absolute;right:12px;bottom:12px;max-width:360px;padding:10px 12px;border-radius:10px;',
        'background:rgba(20,20,26,.96);border:1px solid rgba(120,170,255,.35);color:#e7ecff;font:12px/1.6 system-ui,sans-serif;',
        'box-shadow:0 10px 30px rgba(0,0,0,.4)}',
        '.dpr-note .q{opacity:.75;margin-bottom:6px;white-space:pre-wrap;max-height:72px;overflow:auto}',
        '.dpr-note .row{display:flex;gap:6px;margin-top:8px}',
        '.dpr-cfg{display:flex;flex-direction:column;gap:8px;padding:10px 0;font:13px/1.6 system-ui,sans-serif}',
        '.dpr-cfg input[type=text]{width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:#1b1b20;color:#eee;font:12px/1.4 ui-monospace,monospace}',
        '.dpr-cfg label{display:flex;align-items:center;gap:8px}',
        '.dpr-help{opacity:.7;font-size:12px}'
      ].join('')
      var el = document.createElement('style')
      el.id = 'dsh-paper-reader-style'
      el.textContent = css
      document.head.appendChild(el)
    }

    /* ---------------- 浮层：启动按钮 + 面板 ---------------- */
    function PaperReaderOverlay() {
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var statusState = React.useState('unknown')   // unknown | ok | down
      var status = statusState[0]
      var setStatus = statusState[1]
      var noteState = React.useState(null)          // 从精读器 postMessage 过来的批注
      var note = noteState[0]
      var setNote = noteState[1]
      var sentState = React.useState('')
      var sent = sentState[0]
      var setSent = sentState[1]
      var urlState = React.useState(readUrl())
      var url = urlState[0]
      var setUrl = urlState[1]
      var reloadState = React.useState(0)
      var reloadKey = reloadState[0]
      var bumpReload = reloadState[1]

      React.useEffect(function () {
        injectStyle()
        var alive = true
        function ping() {
          fetch(readUrl().replace(/\/app\/?$/, '') + '/api/health', { cache: 'no-store' })
            .then(function (r) { return r.ok ? 'ok' : 'down' })
            .catch(function () { return 'down' })
            .then(function (s) { if (alive) setStatus(s) })
        }
        ping()
        var timer = setInterval(ping, 10000)
        return function () { alive = false; clearInterval(timer) }
      }, [])

      React.useEffect(function () {
        function onMessage(ev) {
          var d = ev && ev.data
          if (!d || d.source !== 'paper-reader') return
          if (d.type === 'annotation') {
            setNote({
              q: (d.paperTitle ? '《' + d.paperTitle + '》' : '') + (d.unitTitle ? ' · ' + d.unitTitle : ''),
              quote: d.quote || '',
              note: d.note || ''
            })
            setSent('')
          }
        }
        window.addEventListener('message', onMessage)
        return function () { window.removeEventListener('message', onMessage) }
      }, [])

      function askAgent() {
        if (!note) return
        var text = ['【论文批注】', note.q, note.quote ? '原文：' + note.quote : '', note.note ? '我的批注：' + note.note : '',
          '请针对这条批注讲解：我在这一步理解得对不对？关键推导是什么？'].filter(Boolean).join('\n')
        sendToAgent(text).then(function (r) {
          setSent(r.ok ? (r.how === 'session' ? '已发送给当前会话' : '已复制到剪贴板，可粘贴给 agent') : '发送失败：' + (r.error || ''))
        })
      }

      function saveUrl() {
        writeUrl(url)
        bumpReload(reloadKey + 1)
      }

      var fab = h('button', {
        className: 'dpr-fab',
        title: '论文精读器（本地服务）',
        onClick: function () { setOpen(!open) }
      },
        h('span', { className: 'dpr-dot ' + (status === 'ok' ? 'on' : status === 'down' ? 'off' : '') }),
        h('span', null, '精读器')
      )

      var panel = open ? h('div', { className: 'dpr-panel', 'data-dsh-plugin': PACKAGE_ID },
        h('div', { className: 'dpr-head' },
          h('b', null, '论文精读器'),
          h('span', { className: 'dpr-help' }, status === 'ok' ? '服务已连接' : status === 'down' ? '未检测到本地服务' : '检测中…'),
          h('span', { className: 'sp' }),
          h('button', { className: 'dpr-btn', onClick: function () { bumpReload(reloadKey + 1) } }, '刷新'),
          h('button', { className: 'dpr-btn', onClick: function () { window.open(readUrl(), '_blank') } }, '新窗口'),
          h('button', { className: 'dpr-btn', onClick: function () { setOpen(false) } }, '收起')
        ),
        h('div', { className: 'dpr-body' },
          status === 'down'
            ? h('div', { className: 'dpr-empty' },
                h('div', null, '还没有检测到本地精读器服务。'),
                h('div', null, '在项目目录里运行 '), h('code', null, 'npm start'),
                h('div', { className: 'dpr-help' }, '默认地址 ' + readUrl()),
                h('div', { style: { display: 'flex', gap: '8px' } },
                  h('button', { className: 'dpr-btn', onClick: function () { writeUrl(DEFAULT_URL); setUrl(DEFAULT_URL); bumpReload(reloadKey + 1) } }, '用默认地址重试'),
                  h('button', { className: 'dpr-btn', onClick: function () { setOpen(false) } }, '关闭')))
            : h('iframe', {
                key: reloadKey,
                src: readUrl(),
                title: 'paper-reader',
                allow: 'clipboard-write'
              })
        ),
        note ? h('div', { className: 'dpr-note' },
          h('div', { className: 'q' }, note.q),
          note.quote ? h('div', { className: 'q' }, '「' + note.quote + '」') : null,
          note.note ? h('div', null, note.note) : null,
          sent ? h('div', { className: 'dpr-help', style: { marginTop: '6px' } }, sent) : null,
          h('div', { className: 'row' },
            h('button', { className: 'dpr-btn', onClick: askAgent }, '发给当前会话'),
            h('button', { className: 'dpr-btn', onClick: function () { setNote(null) } }, '忽略')
          )
        ) : null
      ) : null

      return h(Fragment, null, fab, panel)
    }

    /* ---------------- 设置页分区 ---------------- */
    function SettingsSection() {
      var urlState = React.useState(readUrl())
      var url = urlState[0]
      var setUrl = urlState[1]
      var embedState = React.useState(readEmbed())
      var embed = embedState[0]
      var setEmbed = embedState[1]
      var msgState = React.useState('')
      var msg = msgState[0]
      var setMsg = msgState[1]

      function check() {
        setMsg('检测中…')
        fetch(url.replace(/\/app\/?$/, '') + '/api/health', { cache: 'no-store' })
          .then(function (r) { return r.json() })
          .then(function (j) { setMsg('已连接 · 版本 ' + (j.version || '?') ) })
          .catch(function () { setMsg('未连接：请在项目目录运行 npm start') })
      }

      return h('div', { className: 'dpr-cfg' },
        h('div', null, '精读器本地服务地址（由 pushd 项目目录 → npm start 提供）'),
        h('input', { type: 'text', value: url, onInput: function (e) { setUrl(e.target.value) } }),
        h('label', null,
          h('input', { type: 'checkbox', checked: embed, onChange: function (e) { setEmbed(e.target.checked); writeEmbed(e.target.checked) } }),
          h('span', null, '在 DSH 内用浮层内嵌精读器（关闭后只保留「新窗口」入口）')
        ),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('button', { className: 'dpr-btn', onClick: function () { writeUrl(url); setMsg('已保存') } }, '保存地址'),
          h('button', { className: 'dpr-btn', onClick: check }, '测试连接')
        ),
        msg ? h('div', { className: 'dpr-help' }, msg) : null,
        h('div', { className: 'dpr-help' }, '批注桥：在精读器里保存批注后，右下角会弹出「发给当前会话」，把批注连同原文一起交给 agent。')
      )
    }

    /* ---------------- Cordis 插件 ---------------- */
    function apply(ctx) {
      ctxRef = ctx
      ctx.slots.inject('shell.overlay', function* () {
        yield ctx.slots.register(
          { name: 'shell.overlay', id: 'paper-reader-overlay', order: 1200 },
          PaperReaderOverlay
        )
      })
      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register(
          { name: 'settings.section', id: 'paper-reader-settings', order: 90, label: function () { return '精读器' } },
          SettingsSection
        )
      })
    }

    return { name: 'paper-reader', inject: ['slots', 'connection'], apply: apply }
  }
})()
