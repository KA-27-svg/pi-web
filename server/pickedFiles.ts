import * as path from 'path';

/** 最多记住多少个刚选过的路径 */
export const MAX_REMEMBERED = 200;

/**
 * 「用户刚亲手选过」的文件路径。
 *
 * 系统对话框拿回来的路径在工作目录之外，而 read_attachment 原本只允许读工作目录
 * 里面的文件。这个白名单就是那道闸：**只有用户自己在对话框里选过的绝对路径**
 * 才允许被读取，而不是「任意绝对路径」——否则那个接口就成了任意文件读取。
 */
export class PickedFiles {
  private allowed = new Set<string>();

  remember(paths: Iterable<string>): void {
    for (const item of paths) {
      const resolved = path.resolve(item);
      // 重新加入时挪到末尾，保证下面的淘汰淘汰的是最旧的
      this.allowed.delete(resolved);
      this.allowed.add(resolved);
    }

    while (this.allowed.size > MAX_REMEMBERED) {
      const oldest = this.allowed.values().next().value;
      if (oldest === undefined) break;
      this.allowed.delete(oldest);
    }
  }

  allows(target: string): boolean {
    return this.allowed.has(path.resolve(target));
  }

  get size(): number {
    return this.allowed.size;
  }
}
