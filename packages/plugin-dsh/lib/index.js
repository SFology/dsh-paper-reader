/**
 * 宿主半（Node 侧）。DSH 按 package.json 的 main 解析到这里，
 * cordis.patch.yml 的 insert 行负责把它挂进配置树。
 *
 * 职责故意保持很小：
 *   - 打印加载/卸载日志（便于确认插件是否生效）；
 *   - 暴露一个 ctx.paperReader 服务对象，供其它插件/命令查询精读器地址；
 *   - 不启动子进程、不写文件、不碰网络 —— 精读器服务由用户自己 `npm start`。
 *
 * 为什么不在宿主半拉起服务：桌面应用的生命周期与端口管理不可控，
 * 静默 spawn 一个常驻 HTTP 服务会让"插件卸载后端口仍被占用"。
 */
export const name = 'paper-reader';

/** 不阻塞启动：拿不到服务也不影响其它插件 */
export const inject = [];

export function apply(ctx) {
  const log = (...a) => { try { ctx.logger?.info?.('[paper-reader]', ...a); } catch { /* 无 logger 时静默 */ } };

  ctx.effect(() => {
    // 供其它插件读取的轻量句柄（不含任何密钥）
    const service = {
      /** 精读器本地服务默认地址 */
      url: 'http://127.0.0.1:8788/app/',
      /** 健康检查地址 */
      healthUrl: 'http://127.0.0.1:8788/api/health',
      docs: 'https://github.com/SFology/dsh-paper-reader#readme'
    };
    try {
      if (typeof ctx.provide === 'function') ctx.provide('paperReader', service);
    } catch { /* 老版本没有 provide 就跳过 */ }
    log('host half loaded');
    return () => log('host half unloaded');
  }, 'paper-reader: lifecycle');
}
