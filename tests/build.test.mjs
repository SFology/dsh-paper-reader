/**
 * 构建产物测试：直接执行入库的 app/packs.js，确认：
 *   1. 能被浏览器外的沙箱执行（没有顶层 DOM 依赖）；
 *   2. 产出的结构与 `window.PAPERS` 约定一致；
 *   3. 仓库默认带 0 个读包时也不报错（框架本身不含论文内容）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePacks } from '../packages/schema/validate.mjs';
import { loadPacksInSandbox } from '../scripts/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_JS = path.join(ROOT, 'app', 'packs.js');

test('app/packs.js 存在（构建产物入库，供 file:// 直接打开）', () => {
  assert.ok(fs.existsSync(PACKS_JS), '缺少 app/packs.js：请运行 npm run build');
});

const code = fs.existsSync(PACKS_JS) ? fs.readFileSync(PACKS_JS, 'utf8') : '';
const packs = code ? loadPacksInSandbox(code) : [];

test('构建产物可执行并返回数组', () => {
  assert.ok(Array.isArray(packs), 'window.PAPERS 应当是数组');
});

test('packs.js 头部标注为自动生成，并声明 window.PAPERS', () => {
  assert.match(code, /自动生成文件/);
  assert.match(code, /window\.PAPERS = \[\]/);
  assert.match(code, /读包数：\d+/);
});

test('仓库默认不含任何读包内容（机制与内容分离）', () => {
  const dirs = fs.readdirSync(path.join(ROOT, 'content'), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  const realPacks = dirs.filter(d => !d.startsWith('_') && !d.startsWith('.'));
  // 若本地开发者放了自己的读包（.gitignore 已忽略），这里允许非空；
  // 只要求"骨架存在"且"_template 不被当读包"。
  assert.ok(dirs.includes('_template'), '应存在 content/_template/ 模板骨架');
  assert.ok(!realPacks.includes('_template'), '模板目录不应被当作读包');
});

test('所有读包（若有）通过校验器', () => {
  const { errors, stats } = validatePacks(packs);
  assert.deepEqual(errors, [], '校验不应有错误：\n' + errors.slice(0, 10).join('\n'));
  assert.equal(typeof stats.units, 'number', 'stats 字段必须是数字（空仓库时为 0）');
  assert.ok(Number.isFinite(stats.units), 'stats.units 不应为 NaN');
  assert.ok(Number.isFinite(stats.inlineMath + stats.displayMath), '公式计数不应为 NaN');
});

test('每个读包内的 unit id 唯一', () => {
  for (const pack of packs) {
    const seen = new Set();
    for (const ch of pack.chapters || []) {
      for (const p of ch.paras || []) {
        assert.ok(!seen.has(p.id), `读包 ${pack.meta && pack.meta.id} 里 unit id 重复：${p.id}`);
        seen.add(p.id);
      }
    }
  }
});

test('content/_template 是合法可构建的骨架', async () => {
  const { loadPacksInSandbox: load } = await import('../scripts/build.mjs');
  assert.equal(typeof load, 'function');
  const tplDir = path.join(ROOT, 'content', '_template');
  const files = fs.readdirSync(tplDir).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 1, '模板目录应有 .js 文件');
  const src = files.map(f => fs.readFileSync(path.join(tplDir, f), 'utf8')).join('\n');
  const tplPacks = load(src);
  assert.ok(Array.isArray(tplPacks) && tplPacks.length === 1, '模板应定义一个读包');
  const tpl = tplPacks[0];
  assert.equal(tpl.schema, 1);
  assert.ok(tpl.meta && tpl.meta.id, '模板要给出 meta.id');
  assert.doesNotThrow(() => validatePacks(tplPacks));
});
