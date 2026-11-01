/**
 * 读包格式校验器测试：用内存对象构造"合法/非法"读包，
 * 断言 validatePack 能分别放过/拦住对应的错误。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePack, validatePacks, tokenizeMath, stripMath } from '../packages/schema/validate.mjs';

/** 构造一个最小合法读包；overrides 用于定点破坏 */
function makePack(overrides = {}) {
  const pack = {
    schema: 1,
    meta: { id: 'demo', title: '演示读包', lang: 'zh', authors: [] },
    chapters: [
      {
        id: 'c1',
        num: '1',
        title: '第一章',
        paras: [
          {
            id: 'c1p1',
            title: '单元一',
            raw: '这是原文，含一个行内公式 $a^2+b^2=c^2$。第二句可以逐句划线。',
            explain: '这是离线讲解，含独立公式 $$\\int_0^1 x\\,dx = \\tfrac12$$。',
            tags: ['核心'],
            gloss: [{ anchor: '这是原文', note: '注解：anchor 必须出现在 raw 里。' }],
            quiz: [{ q: '公式是？', options: ['勾股', '欧拉'], answer: 0, hint: '看指数', why: '是勾股。' }],
            faq: [{ q: '为什么？', a: '因为所以。' }],
            legend: [{ sym: '$a$', desc: '边长' }]
          }
        ]
      }
    ]
  };
  return { ...pack, ...overrides };
}

const errorsOf = pack => validatePack(pack, { katex: undefined }).errors.join('\n');
const ok = pack => assert.equal(errorsOf(pack), '', '应当无错误：\n' + errorsOf(pack));

test('合法读包通过校验', () => {
  ok(makePack());
});

test('schema 版本不符会报错', () => {
  assert.match(errorsOf(makePack({ schema: 2 })), /schema 应为 1/);
});

test('meta.id 与 title 必填', () => {
  const p = makePack();
  p.meta = { ...p.meta, id: '', title: '' };
  const e = errorsOf(p);
  assert.match(e, /meta\.id 缺失/);
  assert.match(e, /meta\.title 缺失/);
});

test('单元 id 重复会报错', () => {
  const p = makePack();
  const unit = p.chapters[0].paras[0];
  p.chapters[0].paras = [unit, { ...unit, title: '重复 id' }];
  assert.match(errorsOf(p), /unit id 重复: c1p1/);
});

test('缺 raw / explain', () => {
  const p = makePack();
  delete p.chapters[0].paras[0].raw;
  delete p.chapters[0].paras[0].explain;
  const e = errorsOf(p);
  assert.match(e, /缺 raw/);
  assert.match(e, /缺 explain/);
});

test('quiz.answer 越界会报错', () => {
  const p = makePack();
  p.chapters[0].paras[0].quiz[0].answer = 5;
  assert.match(errorsOf(p), /answer 越界或非整数: 5/);
});

test('gloss.anchor 不在 raw 里会报错（忽略公式与空白）', () => {
  const p = makePack();
  p.chapters[0].paras[0].gloss[0].anchor = '这句话根本不存在';
  assert.match(errorsOf(p), /anchor 不在 raw 纯文本中/);

  // 反过来：anchor 里带公式、raw 里带公式，去掉公式后仍应匹配
  const p2 = makePack();
  p2.chapters[0].paras[0].gloss[0].anchor = '含一个行内公式';
  ok(p2);
});

test('KaTeX 不支持的写法会被拦住（\\dots / CJK in \\text）', () => {
  const p = makePack();
  delete p.chapters[0].paras[0].gloss;   // 只测公式，去掉会失效的锚点
  p.chapters[0].paras[0].raw = '列举 $y_1,\\dots,y_N$ 这些点。';
  assert.match(errorsOf(p), /不支持的写法/);

  const p2 = makePack();
  delete p2.chapters[0].paras[0].gloss;
  p2.chapters[0].paras[0].raw = '文本公式 $\\text{中文}$ 不允许。';
  assert.match(errorsOf(p2), /不支持的写法/);
});

test('未配平的 $ 会报错', () => {
  const p = makePack();
  delete p.chapters[0].paras[0].gloss;
  p.chapters[0].paras[0].raw = '这里少一个美元符号 $x^2。';
  assert.match(errorsOf(p), /未配平的 \$/);
});

test('未知数学命令会被 KaTeX 严格渲染拦住', () => {
  const p = makePack();
  delete p.chapters[0].paras[0].gloss;
  p.chapters[0].paras[0].raw = '坏公式 $\\notacommand{x}$。';
  assert.match(errorsOf(p), /KaTeX/);
});

test('跨读包 meta.id 重复会报错', () => {
  const a = makePack();
  const b = makePack();
  const { errors } = validatePacks([a, b]);
  assert.match(errors.join('\n'), /meta\.id 重复: demo/);
});

test('tokenizeMath / stripMath 行为', () => {
  const toks = tokenizeMath('前 $a$ 中 $$b$$ 后');
  assert.deepEqual(toks.map(t => t.t), ['text', 'm', 'text', 'D', 'text']);
  assert.equal(stripMath('前 $a$ 中 $$b$$ 后').replace(/\s/g, ''), '前中后');
});
