import { StringDecoder } from 'string_decoder';

/**
 * 把子进程 stdout 的字节流切成整行。
 *
 * 不能直接 `chunk.toString('utf-8')`：块边界可能落在多字节字符（中文 3 字节）中间，
 * 跨界的那半个字符会被替换成 U+FFFD，广播到界面就成了偶发的「�」。
 * StringDecoder 会把不完整的序列留到下一块再拼。
 */
export class LineDecoder {
  private decoder = new StringDecoder('utf-8');
  private pending = '';

  /** 喂一块数据，返回这次能确定的完整行（不含换行符） */
  push(chunk: Buffer | string): string[] {
    const text =
      this.pending + (typeof chunk === 'string' ? chunk : this.decoder.write(chunk));
    const lines = text.split('\n');
    this.pending = lines.pop() ?? '';
    return lines;
  }

  /** 流结束时取出结尾没有换行的最后一段 */
  flush(): string[] {
    const text = this.pending + this.decoder.end();
    this.pending = '';
    return text ? text.split('\n') : [];
  }
}
