# dsh-plugin-paper-reader

在 DeepSeek Harness 的 Web GUI 里直接打开论文精读器：一个右下角浮层内嵌本地精读器页面，并把你在精读器里写的**批注**连同原文一起交给当前会话的 agent。

## 它做什么

| 扩展点 | 行为 |
|---|---|
| `shell.overlay` | 右下角「精读器」悬浮按钮 + 可缩放面板（iframe 内嵌 `http://127.0.0.1:8788/app/`）。状态点显示本地服务是否在线 |
| `settings.section` | 设置页「精读器」分区：改服务地址、测试连接、开关内嵌模式 |
| 批注桥 | 精读器里保存批注 → `postMessage` 给插件 → 弹出卡片 → 「发给当前会话」走 `remote.commands.execute(sessionId, text, [])`，失败自动降级为剪贴板 |

## 安装（本地包）

```bash
# 1) 先让精读器能跑起来
cd dsh-paper-reader
npm start          # http://127.0.0.1:8788/app/

# 2) 把插件装进桌面版 profile
dsh plugin --profile desktop add ./packages/plugin-dsh

# 3) 重启 DSH 桌面应用（客户端插件在启动时装配，必须重启）
```

重启后在任意会话右下角应看到「精读器」按钮。

> 安装位置：`C:\Users\<you>\.dsh\profiles\desktop\`（DSH 没有 `~/.dsh/plugins` 这类目录）。
> 生效单元是 profile 的 `package.json` → `dsh.profile.bundles` 列表。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-plugin-paper-reader
```

## 结构（一包两半）

```
packages/plugin-dsh/
  package.json        main=lib/index.js（宿主半）
                      exports["./client"]=lib/client.js（浏览器半）
                      dsh.bundle.patch → cordis.patch.yml（挂载声明）
                      dsh.client={platform:"web",inject:["@deepseek-ai/dsh-client-connection"]}
  cordis.patch.yml    一条 insert entry，id 与包名一致
  lib/index.js        宿主半：生命周期日志 + ctx.provide('paperReader')
  lib/client.js       浏览器半：overlay 浮层 + 设置分区 + 批注桥
  verify.mjs          离线契约校验（不需要启动 DSH）
```

**浏览器半的硬约束**（违反会静默失效）：

1. 不能有顶层 `import` / `export` —— 平台模块通过 `factory(require)` 取；
2. 执行时只注册 factory；副作用放进 factory 闭包；
3. `factory(require)` **直接返回**模块对象，而不是"返回 factory 的函数"；
4. React 组件用 `require('react')` + `require('react/jsx-runtime')`，不要 JSX（没有编译步骤）。

## 自检

```bash
node packages/plugin-dsh/verify.mjs
```

它会校验 manifest 字段、patch 结构、client bundle 可执行性、`apply(ctx)` 是否往两个槽各注册了组件 —— 全部在 `node:vm` 里跑，不启动 DSH、不访问 13133。当前 22 项全部 PASS。

## 已知限制

- **需要本地服务**：插件不自带 LLM，也不启动子进程；先 `npm start` 起精读器。
- **发送给 agent 依赖 DSH 版本**：`remote.commands.execute` 在部分版本上不接受纯文本；失败时降级为剪贴板。
- **iframe 里 localStorage 属于 127.0.0.1:8788**，与 DSH 页面不同源，因此进度/批注保存在精读器自己的存储里（这是刻意的：关掉 DSH 也能继续读）。
- 未上架插件市场；只支持本地路径安装。

## 设计取舍：为什么不做 iframe 之外的深度集成

DSH 的客户端插件能往 95 个命名槽注册 React 组件，理论上可以把"逐段门禁""批注列表"原生重写成 DSH 组件。但那会：

1. 把精读器的核心逻辑与 DSH 的 UI 契约绑死（升级即碎）；
2. 丢掉"`file://` 直接打开也能读"零依赖特性；
3. 让非 DSH 用户无法使用。

所以这里选**薄插件 + 厚网页**：插件只负责"嵌入"与"把批注递进去"，精读器本体保持独立可运行。
