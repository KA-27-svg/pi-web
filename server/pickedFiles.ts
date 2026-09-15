import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/** 最多记住多少个刚选过的路径 */
export const MAX_REMEMBERED = 200;

/**
 * 这份白名单存在哪。
 * 放在 pi 的 agent 目录下（会话文件也在这儿），是桥接唯一的持久化状态。
 */
export function pickedFilesStorePath(): string {
  return (
    process.env.PI_PICKED_FILES ||
    path.join(os.homedir(), '.pi', 'agent', 'pi-web-picked-files.json')
  );
}

/**
 * 「用户刚亲手选过」的文件路径。
 *
 * 系统对话框拿回来的路径在工作目录之外，而读取/打开附件原本只允许工作目录里面的
 * 文件。这个白名单就是那道闸：**只有用户自己在对话框里选过的绝对路径**才放行，
 * 而不是「任意绝对路径」——否则那个接口就成了任意文件读取 / 任意程序启动。
 *
 * 持久化的原因：历史消息里的附件会在很多天后被点击。不落盘的话，桥接一重启，
 * 「从电脑选择」的文件就都打不开了。
 */
export class PickedFiles {
  private allowed = new Set<string>();
  private file: string | null;

  constructor(file: string | null = null) {
    this.file = file;
  }

  /** 从磁盘读回来。文件不存在或坏掉都当作空——不影响功能，只是要重新选一次。 */
  async load(): Promise<void> {
    if (!this.file) return;

    const raw = await fs.readFile(this.file, 'utf-8').catch(() => null);
    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (typeof item === 'string') this.add(item);
      }
    } catch {
      // 坏掉就当空
    }
  }

  remember(paths: Iterable<string>): void {
    for (const item of paths) this.add(item);
    void this.persist();
  }

  allows(target: string): boolean {
    return this.allowed.has(path.resolve(target));
  }

  get size(): number {
    return this.allowed.size;
  }

  private add(item: string): void {
    const resolved = path.resolve(item);
    // 重新加入时挪到末尾，保证下面淘汰的是最旧的
    this.allowed.delete(resolved);
    this.allowed.add(resolved);

    while (this.allowed.size > MAX_REMEMBERED) {
      const oldest = this.allowed.values().next().value;
      if (oldest === undefined) break;
      this.allowed.delete(oldest);
    }
  }

  private async persist(): Promise<void> {
    if (!this.file) return;

    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, `${JSON.stringify([...this.allowed], null, 2)}\n`, 'utf-8');
    } catch (error) {
      console.error('[Pi Bridge] Failed to persist picked files:', error);
    }
  }
}
