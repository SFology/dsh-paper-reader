#!/usr/bin/env node
/**
 * 一键启动：构建读包 -> 起本地服务 -> 打开浏览器。
 *
 *   npm start
 *   node scripts/start.mjs --port 8790 --no-open
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const port = Number(arg('port', process.env.PAPER_READER_PORT || 8788));
const noOpen = argv.includes('--no-open');

// 1) 构建（同时校验内容）
const build = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.mjs')], { stdio: 'inherit' });
if (build.status !== 0) {
  console.error('\n构建失败，已停止启动。');
  process.exit(build.status || 1);
}

// 2) 起服务
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, PAPER_READER_PORT: String(port) }
});

// 3) 打开浏览器（等端口就绪）
const url = `http://127.0.0.1:${port}/app/`;
if (!noOpen) {
  const tryOpen = (n = 0) => {
    fetch(`http://127.0.0.1:${port}/api/health`)
      .then(() => {
        const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
          : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
        spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
      })
      .catch(() => { if (n < 30) setTimeout(() => tryOpen(n + 1), 200); });
  };
  tryOpen();
}

const stop = () => { try { child.kill(); } catch { /* 忽略 */ } process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', code => process.exit(code === null ? 0 : code));
