#!/usr/bin/env node
// 离线契约校验：不需要启动 DSH，也不需要访问 127.0.0.1:13133。
// 它做 4 件事：
//   1. 校验 package.json 里的 dsh.bundle / dsh.client / exports["./client"]
//      （字段名与 @deepseek-ai/dsh-client-modules 的解析器一致）
//   2. 校验 cordis.patch.yml 的 insert 行结构（id 行不能带行尾注释）
//   3. 在 stub 的 window.__ModuleLoader__ + stub react 下真正执行 lib/client.js，
//      确认它注册了 factory、factory(require) 返回 { name, inject, apply }
//   4. 用 stub ctx 调 apply()，确认往 'shell.overlay' / 'settings.section' 两个
//      槽各注册了一个组件
//
// 用法： node verify.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
let failures = 0
const ok = (label, extra = '') => console.log(`PASS  ${label}${extra ? '  — ' + extra : ''}`)
const bad = (label, detail) => {
  failures++
  console.log(`FAIL  ${label}${detail ? '  — ' + detail : ''}`)
}

// ---------- 1. manifest ------------------------------------------------
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))

const at = (obj, key) => (obj == null ? undefined : obj[key])

const mandatory = [
  ['main', pkg.main, (v) => typeof v === 'string' && v.length > 0],
  ['exports["./client"]', at(at(pkg.exports, './client'), 'default'), (v) => typeof v === 'string' && v.length > 0],
  ['dsh.bundle.patch', at(at(at(pkg.dsh, 'bundle'), 'patch'), 'default') ?? at(at(pkg.dsh, 'bundle'), 'patch'), (v) => typeof v === 'string'],
  ['dsh.client.platform', at(at(pkg.dsh, 'client'), 'platform'), (v) => typeof v === 'string'],
]
for (const [path, value, check] of mandatory) {
  check(value) ? ok(`manifest ${path}`, JSON.stringify(value)) : bad(`manifest ${path}`, `missing/invalid (${JSON.stringify(value)})`)
}
const injectList = pkg?.dsh?.client?.inject
Array.isArray(injectList) && injectList.every((s) => typeof s === 'string')
  ? ok('manifest dsh.client.inject', `${injectList.length} 项`)
  : bad('manifest dsh.client.inject', '必须是 string[]')
const external = pkg?.dsh?.client?.external
external === undefined
  ? ok('manifest dsh.client.external', '未声明（只用基线模块，合法）')
  : ok('manifest dsh.client.external', `${external.length} 项`)

// 两个入口文件必须真实存在
for (const rel of [pkg.main, pkg.exports['./client'].default, pkg.dsh.bundle.patch]) {
  try {
    readFileSync(join(here, rel))
    ok(`file exists ${rel}`)
  } catch {
    bad(`file exists ${rel}`, 'not found')
  }
}

// ---------- 2. cordis.patch.yml ---------------------------------------
const patch = readFileSync(join(here, 'cordis.patch.yml'), 'utf8')
const entryLines = patch.split(/\r?\n/).filter((l) => /^\s*-\s+id:\s*\S/.test(l))
if (entryLines.length === 1) ok('patch 有 1 条 insert entry')
else bad('patch entry 数', `期望 1，实际 ${entryLines.length}`)
const entryLine = entryLines[0] ?? ''
const hasTrailingComment = /#/.test(entryLine)
if (hasTrailingComment) bad('patch entry 行尾注释', 'id 行不能带行尾注释')
else ok('patch entry 行无行尾注释')

const patchNameOk = /name:\s*'dsh-plugin-paper-reader'/.test(patch)
if (patchNameOk) ok('patch name 与包名一致')
else bad('patch name 与包名一致', 'name 必须等于 package.json name')

// ---------- 3. 在 stub 环境里执行 client bundle ------------------------
const factories = new Map()
const sandboxWindow = {
  __ModuleLoader__: {
    load(info) {
      factories.set(info.id, info.factory)
    },
  },
  navigator: { clipboard: { writeText: async () => {} } },
}
const context = vm.createContext({
  window: sandboxWindow,
  globalThis: sandboxWindow,
  console,
  navigator: sandboxWindow.navigator,
  document: { createElement: () => ({}) },
})

const bundleSource = readFileSync(join(here, pkg.exports['./client'].default), 'utf8')
try {
  new vm.Script(bundleSource, { filename: 'client.js' }).runInContext(context)
  ok('client bundle 可执行')
} catch (error) {
  bad('client bundle 可执行', error.message)
}

if (factories.size !== 1) {
  bad('注册 factory', `期望 1 个，实际 ${factories.size}`)
} else {
  ok('注册 factory', `id = ${[...factories.keys()][0]}`)
}

// stub 平台种子模块
const reactStub = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  createElement: (...args) => ({ args }),
}
const requireStub = (id) => {
  if (id === 'react') return reactStub
  if (id === 'react/jsx-runtime')
    return {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
      Fragment: 'Fragment',
    }
  throw new Error(`unexpected require: ${id}`)
}

const factory = [...factories.values()][0]
let plugin
try {
  plugin = factory(requireStub)
  ok('factory(require) 返回模块')
} catch (error) {
  bad('factory(require) 返回模块', error.message)
}

plugin && typeof plugin.name === 'string'
  ? ok('插件 name', plugin.name)
  : bad('插件 name', '缺失')
plugin && Array.isArray(plugin.inject)
  ? ok('插件 inject', plugin.inject.join(', '))
  : bad('插件 inject', '必须是数组')
plugin && typeof plugin.apply === 'function'
  ? ok('插件 apply', 'function')
  : bad('插件 apply', '缺失')

// ---------- 4. 用 stub ctx 调用 apply ---------------------------------
const registrations = []
const stubCtx = {
  effect: (fn) => {
    const dispose = fn()
    return dispose
  },
  get: () => undefined,
  provide: () => {},
  logger: { info: () => {}, warn: () => {} },
  slots: {
    inject(slotName, gen) {
      const it = gen()
      let step = it.next()
      while (!step.done) {
        step = it.next({ slotName })
      }
      return () => {}
    },
    register(spec, component) {
      registrations.push({ slot: spec.name, id: spec.id, order: spec.order, component })
      return { spec, component }
    },
  },
}

try {
  plugin.apply(stubCtx)
  ok('apply(ctx) 执行')
} catch (error) {
  bad('apply(ctx) 执行', error.message)
}

const slots = registrations.map((r) => r.slot).sort()
const expected = ['settings.section', 'shell.overlay']
JSON.stringify(slots) === JSON.stringify(expected)
  ? ok('槽注册', slots.join(' + '))
  : bad('槽注册', `期望 ${expected.join(' + ')}，实际 ${slots.join(' + ') || '(none)'}`)

for (const r of registrations) {
  typeof r.component === 'function'
    ? ok(`组件 ${r.id} 是函数组件`)
    : bad(`组件 ${r.id}`, '不是函数')
}

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED — 该原型满足 DSH client-plugin 的静态契约'
    : `\n${failures} CHECK(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
