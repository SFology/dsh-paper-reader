#!/usr/bin/env node
/**
 * 校验：只读检查（不改文件），适合 CI 或提交前跑。
 *   node scripts/validate.mjs
 *   node scripts/validate.mjs --json    机器可读输出
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePacks } from '../packages/schema/validate.mjs';
import { loadPacksInSandbox } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = path.join(ROOT, 'app', 'packs.js');
const JSON_OUT = process.argv.includes('--json');

if (!fs.existsSync(PACKS)) {
  console.error('✗ app/packs.js 不存在，先运行 npm run build');
  process.exit(1);
}

const code = fs.readFileSync(PACKS, 'utf8');
let packs;
try {
  packs = loadPacksInSandbox(code);
} catch (e) {
  console.error('✗ app/packs.js 无法执行：' + e.message);
  process.exit(1);
}

const { errors, warnings, perPack, stats } = validatePacks(packs);

if (JSON_OUT) {
  console.log(JSON.stringify({ stats, perPack: perPack.map(r => ({ id: r.id, errors: r.errors.length, warnings: r.warnings.length, stats: r.stats })), errors, warnings }, null, 2));
} else {
  console.log(`读包 ${perPack.length} 个 · 单元 ${stats.units} · 自测 ${stats.quizzes} · 公式 ${stats.inlineMath + stats.displayMath}`);
  if (warnings.length) {
    console.log(`\n提醒 ${warnings.length} 条（不阻塞）：`);
    warnings.slice(0, 15).forEach(w => console.log('  - ' + w));
  }
  if (errors.length) {
    console.error(`\n✗ 错误 ${errors.length} 条：`);
    errors.forEach(e => console.error('  ✗ ' + e));
    process.exit(1);
  }
  console.log('\n✓ 校验通过');
}
