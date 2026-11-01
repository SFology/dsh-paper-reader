/**
 * 配置与密钥发现。
 *
 * 优先级：config.local.json  >  环境变量  >  DSH 已配置的网关密钥  >  DEFAULTS
 *
 * 安全约定（不要破坏）：
 *   - 自动发现的 DSH 密钥**绝不**写进 config.local.json；
 *   - 浏览器只能通过 /api/config 拿到掩码（keyMask），永远拿不到明文。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CFG_FILE = path.join(ROOT, 'config.local.json');
export const DSH_CRED = path.join(os.homedir(), '.dsh', '.credentials.yaml');

export const DEFAULTS = {
  baseUrl: 'https://api.llm.ustc.edu.cn/v1',   // OpenAI 兼容端点（含 /v1）
  model: 'deepseek-flash-2',
  temperature: 0.3,
  maxTokens: 2400,
  systemPrompt: '',        // 空 = 用前端内置 SYS
  timeoutMs: 180000
};

export const PRESETS = [
  { id: 'ustc', name: 'USTC 网关（推荐）', baseUrl: 'https://api.llm.ustc.edu.cn/v1', model: 'deepseek-flash-2', hint: '若 DSH 已配置，密钥自动读取' },
  { id: 'ustc-chat', name: 'USTC 网关 · 快速模型', baseUrl: 'https://api.llm.ustc.edu.cn/v1', model: 'deepseek-flash', hint: '不思考、首字更快' },
  { id: 'deepseek', name: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: '需要自己的 key' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: '需要自己的 key' },
  { id: 'moonshot', name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', hint: '' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', hint: '' },
  { id: 'ollama', name: 'Ollama（本地）', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', hint: '不需要 key' },
  { id: 'lmstudio', name: 'LM Studio（本地）', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model', hint: '不需要 key' }
];

/** 从 DSH 凭据文件里找网关密钥（不打印、不外传） */
export function findDshKey() {
  try {
    if (!fs.existsSync(DSH_CRED)) return null;
    const txt = fs.readFileSync(DSH_CRED, 'utf8');
    const env = process.env.USTC_LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
    if (env) return { key: env, from: '环境变量' };
    const m = txt.match(/^\s*USTC_LLM_API_KEY:\s*["']?([^"'\r\n]+)["']?\s*$/m)
      || txt.match(/^\s*DEEPSEEK_API_KEY:\s*["']?([^"'\r\n]+)["']?\s*$/m);
    if (m && m[1] && m[1].trim()) return { key: m[1].trim(), from: '~/.dsh/.credentials.yaml' };
  } catch { /* 忽略 */ }
  return null;
}

/** 只读本地配置文件（不含默认值与自动发现的密钥） */
export function readCfgFile() {
  try {
    if (!fs.existsSync(CFG_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (e) {
    console.warn('config.local.json 解析失败，已忽略：' + e.message);
    return {};
  }
}

export function loadConfig() {
  const file = readCfgFile();
  const cfg = { ...DEFAULTS, ...file };
  let keySource = '';
  if (!cfg.key) {
    const found = findDshKey();
    if (found) { cfg.key = found.key; keySource = found.from + '（自动发现）'; }
  } else {
    keySource = 'config.local.json';
  }
  cfg.keySource = keySource;
  return cfg;
}

/** 保存配置：只写用户显式设置过的字段，绝不写入自动发现的密钥 */
export function saveConfig(patch = {}) {
  const cur = readCfgFile();
  const next = { ...cur };
  for (const k of ['baseUrl', 'model', 'temperature', 'maxTokens', 'systemPrompt', 'timeoutMs']) {
    if (patch[k] !== undefined && patch[k] !== '') next[k] = patch[k];
  }
  if (typeof patch.key === 'string' && patch.key.trim()) next.key = patch.key.trim();
  fs.writeFileSync(CFG_FILE, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(CFG_FILE, 0o600); } catch { /* Windows 无实际作用 */ }
  return loadConfig();
}

export function maskKey(k) {
  if (!k) return '';
  if (k.length <= 10) return k.slice(0, 2) + '***';
  return k.slice(0, 4) + '…' + k.slice(-4);
}

/** 给浏览器看的配置（无明文密钥） */
export function publicConfig(cfg) {
  return {
    configured: !!(cfg.baseUrl && cfg.model),
    hasKey: !!cfg.key,
    keyMask: maskKey(cfg.key),
    keySource: cfg.keySource || '未配置',
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    timeoutMs: cfg.timeoutMs,
    presets: PRESETS,
    version: readVersion()
  };
}

export function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch { return '0.0.0'; }
}
