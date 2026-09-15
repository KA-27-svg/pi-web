import { describe, expect, it } from 'vitest';
import { LineDecoder } from './lines';

describe('LineDecoder', () => {
  it('按换行切分，最后一段不完整时留到下一次', () => {
    const decoder = new LineDecoder();
    expect(decoder.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(decoder.push('2}\n')).toEqual(['{"b":2}']);
  });

  it('一块里包含多行时全部返回', () => {
    const decoder = new LineDecoder();
    expect(decoder.push('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
  });

  it('多字节字符被块边界切开时不产生乱码', () => {
    // 「你」是 3 字节，切在 4 字节处正好把它劈开；
    // 直接 chunk.toString('utf-8') 会得到 U+FFFD（�）而不是「你好世界」
    const bytes = Buffer.from('你好世界\n', 'utf-8');
    const decoder = new LineDecoder();

    expect(decoder.push(bytes.subarray(0, 4))).toEqual([]);
    expect(decoder.push(bytes.subarray(4))).toEqual(['你好世界']);
  });

  it('逐字节喂入也能拼回原文', () => {
    const bytes = Buffer.from('{"text":"中文"}\n', 'utf-8');
    const decoder = new LineDecoder();
    const lines: string[] = [];

    for (const byte of bytes) lines.push(...decoder.push(Buffer.from([byte])));

    expect(lines).toEqual(['{"text":"中文"}']);
  });

  it('flush 取出结尾没有换行的最后一段', () => {
    const decoder = new LineDecoder();
    decoder.push('a\nb');
    expect(decoder.flush()).toEqual(['b']);
  });

  it('flush 在缓冲为空时不返回内容', () => {
    const decoder = new LineDecoder();
    decoder.push('a\n');
    expect(decoder.flush()).toEqual([]);
  });
});
