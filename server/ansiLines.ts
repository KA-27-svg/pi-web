import { StringDecoder } from 'string_decoder';

/**
 * ANSI 转义：CSI（颜色、光标、清行）与 OSC。
 * 官方安装器与 npm 都会往输出里塞这些，不剥掉的话网页上会看到 `\x1b[36m` 这类乱码。
 */
// 匹配的正是控制字符，这是本模块存在的意义
const ANSI_PATTERN =
  // oxlint-disable-next-line no-control-regex
  /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B[@-Z\\-_]/g;

/**
 * 把安装器输出切成可显示的日志行。
 *
 * 两个必须处理的现实：
 *  - 官方安装器用回车覆盖画进度条（`\r<帧>`），整条进度可能一个 `\n` 都没有。
 *    只按 `\n` 切（像 lines.ts 的 LineDecoder 那样）会把所有帧攒成一行巨型文本。
 *  - 输出里全是 ANSI 控制符。
 *
 * 顺带丢掉空行、压掉连续重复——这份文本是给人看进度的，密集一点比留一堆空行好读。
 * 行首的空格则保留：`  ok ...` 这类缩进本身携带信息。
 *
 * 多字节字符用 StringDecoder 处理，理由与 LineDecoder 相同：块边界可能落在
 * 一个中文字符中间。
 */
export class AnsiLineDecoder {
  private decoder = new StringDecoder('utf-8');
  private pending = '';
  /** 上一条已输出的行，用来压连续重复 */
  private last = '';

  push(chunk: Buffer | string): string[] {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    return this.take();
  }

  flush(): string[] {
    this.pending += this.decoder.end();
    const out = this.take();
    if (this.pending) {
      const tail = this.clean([this.pending]);
      this.pending = '';
      out.push(...tail);
    }
    return out;
  }

  /** 切出所有已结束的段，最后一段留作 pending（可能还没写完） */
  private take(): string[] {
    const segments = this.pending.split(/\r\n|\r|\n/);
    this.pending = segments.pop() ?? '';
    return this.clean(segments);
  }

  private clean(segments: string[]): string[] {
    const out: string[] = [];

    for (const segment of segments) {
      // 只去尾部空白，保留行首缩进
      const text = segment.replace(ANSI_PATTERN, '').replace(/\s+$/, '');
      if (!text.trim()) continue;
      if (text === this.last) continue;

      this.last = text;
      out.push(text);
    }

    return out;
  }
}
