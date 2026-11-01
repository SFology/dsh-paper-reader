/**
 * scripts/fix-math.mjs 的单元测试：
 * 每条规则都要么"改成能渲染的等价形式"，要么明确不动（留给人工）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixMathText } from '../scripts/fix-math.mjs';
import { loadKaTeX, validatePack } from '../packages/schema/validate.mjs';

const fix = s => fixMathText(s).text;

test('\\dots -> \\ldots', () => {
  assert.equal(fix('\\{ \\pm e_1,\\dots,\\pm e_d \\}'), '\\{ \\pm e_1,\\ldots,\\pm e_d \\}');
});

test('\\boxed / \\fbox / \\colorbox 去框保内容', () => {
  assert.equal(fix('\\boxed{R(P)\\le B_d}'), 'R(P)\\le B_d');
  assert.equal(fix('\\fbox{x}'), 'x');
  assert.equal(fix('\\colorbox{red}{x+1}'), 'x+1');
});

test('\\operatorname / \\mathop -> \\mathrm', () => {
  assert.equal(fix('\\operatorname{argmin}_x'), '\\mathrm{argmin}_x');
  assert.equal(fix('\\mathop{\\rm argmax}'), '\\mathrm{\\rm argmax}');
});

test('\\bm / \\boldsymbol -> \\mathbf', () => {
  assert.equal(fix('\\bm{x}'), '\\mathbf{x}');
  assert.equal(fix('\\boldsymbol{\\theta}'), '\\mathbf{\\theta}');
});

test('\\underbrace{X}_{Y} -> (X)_{Y}', () => {
  assert.equal(fix('\\underbrace{a+b}_{n}'), '(a+b)_{n}');
  // 嵌套花括号不能被截断
  assert.equal(fix('\\underbrace{f(x_{1})}_{k}'), '(f(x_{1}))_{k}');
});

test('\\overbrace{X}^{Y} -> (X)^{Y}', () => {
  assert.equal(fix('\\overbrace{a+b}^{n}'), '(a+b)^{n}');
});

test('\\tag 删除', () => {
  assert.equal(fix('x = y \\tag{3}'), 'x = y ');
});

test('align 环境 -> aligned（aligned 是支持的）', () => {
  assert.equal(fix('\\begin{align}a&=b\\end{align}'), '\\begin{aligned}a&=b\\end{aligned}');
});

test('不碰中文正文与普通文本', () => {
  assert.equal(fix('这是正文，含 $a+b$。'), '这是正文，含 $a+b$。');
});

test('修完的公式能通过 KaTeX 严格渲染', () => {
  const katex = loadKaTeX();
  assert.ok(katex, 'KaTeX 应能加载');
  const cases = [
    fix('\\boxed{R(P)\\le B_d}'),
    fix('\\underbrace{a+b}_{n}'),
    fix('\\operatorname{argmin}_x f(x)'),
    fix('\\bm{x}^\\top \\bm{y}'),
    fix('\\dots')
  ];
  for (const expr of cases) {
    assert.doesNotThrow(() => katex.renderToString(expr, { throwOnError: true }), `渲染失败：${expr}`);
  }
});

test('修完的单元能通过 validatePack', () => {
  const katex = loadKaTeX();
  const pack = {
    schema: 1,
    meta: { id: 'fix-demo', title: '修复测试', lang: 'zh', authors: [] },
    chapters: [{
      id: 'c1', num: '1', title: '章',
      paras: [{
        id: 'c1p1', title: '单元',
        raw: fix('设 $x\\in\\mathbb{R}^d$，取 $\\{ \\pm e_1,\\dots,\\pm e_d \\}$，则 $\\boxed{R(P)\\le B_d}$。'),
        explain: fix('由 $\\underbrace{a+b}_{n}$ 得 $\\operatorname{argmin}_x f(x)$。')
      }]
    }]
  };
  const { errors } = validatePack(pack, { katex });
  assert.deepEqual(errors, [], errors.join('\n'));
});
