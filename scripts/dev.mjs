#!/usr/bin/env node
/**
 * 开发模式：监听 content/ 变化，自动重建 app/packs.js。
 *
 *   npm run dev            # 重建 + 提示刷新
 *   npm run dev -- --serve # 同时起服务
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const BUILD = path.join(ROOT, 'scripts', 'build.mjs');
const serve = process.argv.includes('--serve');

let timer = null, server = null, building = false;

function build(reason) {
  if (building) return;
  building = true;
  const t0 = Date.now();
  const p = spawn(process.execPath, [BUILD], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { err += d; });
  p.on('exit', code => {
    building = false;
    const ms = Date.now() - t0;
    if (code === 0) {
      const brief = out.split('\n').filter(l => /合计|已更新|无变化/.test(l)).join(' ').trim();
      console.log(`[build ${new Date().toLocaleTimeString()}] ${reason} ok (${ms}ms) ${brief}`);
    } else {
      console.error(`[build ${new Date().toLocaleTimeString()}] ${reason} 失败：\n${err || out}`);
    }
  });
}

function watch(dir) {
  fs.watch(dir, { recursive: true }, (ev, file) => {
    if (!file || !file.endsWith('.js')) return;
    if (file.includes('packs.js')) return;
    clearTimeout(timer);
    timer = setTimeout(() => build(file), 150);
  });
}

console.log('监听 content/ 变化…（Ctrl+C 退出）');
build('初始构建');
watch(CONTENT);

if (serve) {
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], { stdio: 'inherit' });
  server.on('exit', code => { console.log('服务已退出'); process.exit(code || 0); });
}

const stop = () => { try { server && server.kill(); } catch { /* 忽略 */ } process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
