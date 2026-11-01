/**
 * 本地服务：静态文件 + LLM 网关代理。
 *
 * 为什么需要它：
 *   浏览器不能安全持有 API Key；而精读器要"零配置 + 实时调用"，
 *   就必须有一个本机进程替它注入 Authorization 并把 SSE 归一化。
 *
 * 路由：
 *   GET  /                     -> 302 /app/
 *   GET  /app/*                -> 前端静态文件（app/）
 *   GET  /api/config           -> 公开配置（密钥仅掩码）
 *   POST /api/config           -> 保存配置（写 config.local.json）
 *   GET  /api/models           -> 探测上游可用模型
 *   GET  /api/papers           -> 读包清单（meta），供插件/调试用
 *   POST /api/chat             -> 上游对话（SSE 归一化：{d}增量 / {r}推理 / {done}）
 *   GET  /api/health           -> 健康检查
 *   POST /api/stop             -> 优雅退出
 *
 * 安全：
 *   - 只监听 127.0.0.1；
 *   - 校验 Origin：只允许本机来源与 file://（Origin: null），其它网页借道会被拒；
 *   - 密钥不出服务端。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig, saveConfig, publicConfig, readVersion } from './config.mjs';

const APP_DIR = path.join(ROOT, 'app');
const PORT = Number(process.env.PAPER_READER_PORT || 8788);
const HOST = process.env.PAPER_READER_HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function originAllowed(origin) {
  if (!origin || origin === 'null') return true;              // file:// 页面
  try {
    const u = new URL(origin);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  } catch { return false; }
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || 'null');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('请求体不是合法 JSON：' + e.message)); }
    });
    req.on('error', reject);
  });
}

/** 静态文件（限制在 app/ 内，防目录穿越） */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.replace(/^\/app\/?/, ''));
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const abs = path.resolve(APP_DIR, rel);
  if (!abs.startsWith(APP_DIR + path.sep) && abs !== APP_DIR) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(abs).pipe(res);
  });
}

/** 读包清单：直接执行 app/packs.js 拿 meta（内容由我们自己维护，可信） */
function listPapers() {
  const packsFile = path.join(APP_DIR, 'packs.js');
  try {
    const code = fs.readFileSync(packsFile, 'utf8');
    const win = { PAPERS: [] };
    const packs = new Function('window', '"use strict";\n' + code + '\n;return window.PAPERS;')(win);
    return packs.map(p => ({
      id: p.meta.id,
      title: p.meta.title,
      subtitle: p.meta.subtitle || '',
      lang: p.meta.lang,
      units: p.chapters.reduce((n, c) => n + (c.paras ? c.paras.length : 0), 0),
      version: p.meta.version || ''
    }));
  } catch (e) {
    return { error: '读取读包失败：' + e.message };
  }
}

// ---------------- LLM 上游 ----------------

async function upstream(cfg, pathname, body, signal) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + pathname;
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.key) headers.Authorization = 'Bearer ' + cfg.key;
  return fetch(url, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal });
}

async function handleChat(req, res, cfg) {
  let payload;
  try { payload = await readBody(req); }
  catch (e) { return json(res, 400, { error: e.message }); }

  const msgs = Array.isArray(payload.messages) ? payload.messages : null;
  if (!msgs || !msgs.length) return json(res, 400, { error: 'messages 必须是非空数组' });

  const wantStream = payload.stream !== false;
  const body = {
    model: payload.model || cfg.model,
    messages: msgs,
    temperature: typeof payload.temperature === 'number' ? payload.temperature : cfg.temperature,
    max_tokens: payload.maxTokens || cfg.maxTokens,
    stream: wantStream
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('上游超时')), cfg.timeoutMs || 180000);
  req.on('close', () => ac.abort(new Error('客户端断开')));

  let up;
  try {
    up = await upstream(cfg, '/chat/completions', body, ac.signal);
  } catch (e) {
    clearTimeout(timer);
    return json(res, 502, { error: '无法连接上游：' + e.message, baseUrl: cfg.baseUrl });
  }

  if (!up.ok) {
    clearTimeout(timer);
    const detail = await up.text().catch(() => '');
    return json(res, up.status, {
      error: `上游返回 ${up.status}`,
      detail: detail.slice(0, 1200),
      hint: up.status === 401 ? '密钥无效或无权限' : up.status === 404 ? 'baseUrl 或模型名不对' : up.status === 429 ? '限流，稍后再试' : ''
    });
  }

  const ctype = up.headers.get('content-type') || '';
  if (!wantStream || !ctype.includes('text/event-stream')) {
    const text = await up.text();
    clearTimeout(timer);
    try {
      const j = JSON.parse(text);
      const txt = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
      return json(res, 200, { text: txt || '', raw: txt ? undefined : text.slice(0, 2000) });
    } catch {
      return json(res, 200, { text: '', raw: text.slice(0, 2000) });
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  let doneSent = false;
  const send = obj => { res.write('data: ' + JSON.stringify(obj) + '\n\n'); };
  const sendDone = () => { if (!doneSent) { doneSent = true; send({ done: 1 }); } };
  let gotAny = false;

  try {
    const reader = up.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') { gotAny = true; sendDone(); continue; }
          try {
            const j = JSON.parse(data);
            const ch = (j.choices && j.choices[0]) || {};
            const delta = ch.delta || {};
            if (delta.reasoning_content) { gotAny = true; send({ r: delta.reasoning_content }); }
            if (delta.content) { gotAny = true; send({ d: delta.content }); }
            if (ch.finish_reason) send({ finish: ch.finish_reason });
          } catch { /* 忽略不完整分片 */ }
        }
      }
    }
  } catch (e) {
    if (!res.writableEnded && e && e.name !== 'AbortError') send({ error: '流中断：' + e.message });
  } finally {
    clearTimeout(timer);
    if (!gotAny) send({ error: '上游没有返回任何内容', hint: '检查模型名与 baseUrl' });
    if (!res.writableEnded) { sendDone(); res.end(); }
  }
}

async function handleModels(req, res, cfg) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);
    const up = await upstream(cfg, '/models', null, ac.signal);
    clearTimeout(t);
    const text = await up.text();
    if (!up.ok) return json(res, up.status, { error: `上游返回 ${up.status}`, detail: text.slice(0, 800) });
    let ids = [];
    try {
      const j = JSON.parse(text);
      ids = (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean);
    } catch { return json(res, 200, { models: [], raw: text.slice(0, 1200) }); }
    return json(res, 200, { models: ids, current: cfg.model });
  } catch (e) {
    return json(res, 502, { error: '探测失败：' + e.message });
  }
}

// ---------------- 主服务 ----------------

export function startServer(opts = {}) {
  const port = opts.port || PORT;
  const host = opts.host || HOST;
  let cfg = loadConfig();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || host));
    const p = url.pathname;

    if (req.method === 'OPTIONS') { cors(req, res); res.writeHead(204).end(); return; }
    if (!originAllowed(req.headers.origin)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('origin not allowed'); return; }
    cors(req, res);

    try {
      if (p === '/' || p === '/index.html') { res.writeHead(302, { Location: '/app/' }).end(); return; }
      if (p.startsWith('/app/')) { serveStatic(req, res, p); return; }

      if (p === '/api/health') return json(res, 200, { ok: true, version: readVersion(), uptime: process.uptime() });
      if (p === '/api/config' && req.method === 'GET') return json(res, 200, publicConfig(loadConfig()));
      if (p === '/api/config' && req.method === 'POST') {
        const body = await readBody(req);
        cfg = saveConfig(body);
        return json(res, 200, publicConfig(cfg));
      }
      if (p === '/api/models') { cfg = loadConfig(); return handleModels(req, res, cfg); }
      if (p === '/api/papers') return json(res, 200, { papers: listPapers() });
      if (p === '/api/chat' && req.method === 'POST') { cfg = loadConfig(); return handleChat(req, res, cfg); }
      if (p === '/api/stop' && req.method === 'POST') { json(res, 200, { ok: true }); setTimeout(() => process.exit(0), 120); return; }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + p);
    } catch (e) {
      console.error('路由异常：', e);
      if (!res.headersSent) json(res, 500, { error: e.message });
      else try { res.end(); } catch { /* 忽略 */ }
    }
  });

  server.listen(port, host, () => {
    const c = loadConfig();
    const line = '─'.repeat(52);
    console.log('');
    console.log('  论文精读器 · 已启动');
    console.log('  ' + line);
    console.log('  打开：  http://' + (host === '0.0.0.0' ? '127.0.0.1' : host) + ':' + port + '/app/');
    console.log('  模型：  ' + c.baseUrl + '  ·  ' + c.model);
    console.log('  密钥：  ' + (c.key ? (c.key.slice(0, 4) + '…' + c.key.slice(-4)) : '未配置') + (c.keySource ? '  （' + c.keySource + '）' : ''));
    console.log('  版本：  v' + readVersion());
    console.log('  ' + line);
    console.log('  Ctrl+C 退出');
    console.log('');
  });

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用：改端口用 PAPER_READER_PORT=8790 node server/index.mjs`);
    } else {
      console.error('服务错误：', e);
    }
    process.exit(1);
  });

  return server;
}

const __filename = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) startServer();
