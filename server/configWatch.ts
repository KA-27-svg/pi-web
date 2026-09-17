import * as fs from 'fs/promises';

/**
 * 盯着 pi 的配置文件（auth.json / models.json），有变化就让调用方刷新一次模型列表。
 *
 * 为什么需要它：桥接只在「连接建立」和「网页里保存供应商」时刷新模型。用户在
 * 终端跑完 `/login`、或手改 models.json 加了个模型，已经打开的页面不会自己更新，
 * 得刷新页面重连才发现。
 *
 * 用轮询 mtime 而不是 fs.watch：编辑器保存、npm 安装常是「写临时文件再改名」，
 * fs.watch 盯着的 inode 会被换掉，之后就不再触发。代价是每 N 秒两次 stat，可忽略。
 */

/**
 * 一组文件的变化指纹：mtime + 大小。
 * 带上大小是为了兜住「同一毫秒内改写、mtime 没变」这种情况。
 */
export async function configStamp(files: string[]): Promise<string> {
  const parts: string[] = [];

  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    parts.push(stat ? `${stat.mtimeMs}:${stat.size}` : '-');
  }

  return parts.join('|');
}

export interface ConfigWatchOptions {
  files: string[];
  /** 指纹变了就调一次 */
  onChange: () => void;
  intervalMs?: number;
  /** 注入点：测试里用假时间与假指纹，不碰真实文件系统 */
  read?: (files: string[]) => Promise<string>;
}

/** 轮询配置文件的默认间隔。够快能察觉手工改动，又不至于一直在读盘 */
export const CONFIG_POLL_MS = 4000;

/**
 * 开始盯着配置文件，返回 stop 函数。
 *
 * 第一次只记基线、不触发——启动时读到的东西不该被当成「刚刚变了」。
 * 一次 tick 还没跑完就接着来的话直接跳过，避免慢盘上堆叠。
 */
export function watchConfigFiles(options: ConfigWatchOptions): () => void {
  const intervalMs = options.intervalMs ?? CONFIG_POLL_MS;
  const read = options.read ?? configStamp;

  let last: string | null = null;
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const next = await read(options.files);
      if (last !== null && next !== last) options.onChange();
      last = next;
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
