import { describe, expect, it } from 'vitest';
import { AnsiLineDecoder } from './ansiLines';

describe('AnsiLineDecoder 分段', () => {
  it('按换行切分，最后一段不完整时留到下一次', () => {
    const decoder = new AnsiLineDecoder();
    expect(decoder.push('Installing Pi...\n正在安装')).toEqual(['Installing Pi...']);
    expect(decoder.push(' pi\n')).toEqual(['正在安装 pi']);
  });

  it('按回车切分：进度条反复覆盖不会攒成一行巨型文本', () => {
    // 官方安装器就是这么画进度的：`\r<帧>`，整条进度可能一个 \n 都没有。
    // 只按 \n 切的话，所有这些帧会拼成一整行。
    const decoder = new AnsiLineDecoder();

    expect(decoder.push('resolving\rfetching (1)\rfetching (2)\r')).toEqual([
      'resolving',
      'fetching (1)',
      'fetching (2)',
    ]);
  });

  it('\\r\\n 当作一个换行，不会多切出一个空段', () => {
    const decoder = new AnsiLineDecoder();
    expect(decoder.push('a\r\nb\r\n')).toEqual(['a', 'b']);
  });

  it('跨块的 \\r\\n 不会多切出一个空段', () => {
    const decoder = new AnsiLineDecoder();

    expect(decoder.push('a\r')).toEqual(['a']);
    expect(decoder.push('\nb\r\n')).toEqual(['b']);
  });

  it('丢弃空段', () => {
    const decoder = new AnsiLineDecoder();
    expect(decoder.push('a\n\n\n   \nb\n')).toEqual(['a', 'b']);
  });

  it('压掉连续重复的行（npm 经常重印同一行）', () => {
    const decoder = new AnsiLineDecoder();
    expect(decoder.push('up to date\rup to date\rup to date\r')).toEqual(['up to date']);
  });

  it('重复行中间夹了别的内容就照常输出', () => {
    const decoder = new AnsiLineDecoder();
    expect(decoder.push('a\nb\na\n')).toEqual(['a', 'b', 'a']);
  });
});

describe('AnsiLineDecoder 去 ANSI', () => {
  it('剥掉颜色与光标控制，网页上不该出现 \\x1b[36m', () => {
    const decoder = new AnsiLineDecoder();
    const input = '\u001b[1mPi Installer\u001b[0m\n\u001b[?25l\u001b[2J\u001b[H安装完成\n';

    expect(decoder.push(input)).toEqual(['Pi Installer', '安装完成']);
  });

  it('剥掉清行控制符但保留正文', () => {
    const decoder = new AnsiLineDecoder();
    expect(decoder.push('\r\u001b[Kfetching tarballs (12)\n')).toEqual([
      'fetching tarballs (12)',
    ]);
  });

  it('保留行的前导空格（日志缩进有意义）', () => {
    const decoder = new AnsiLineDecoder();
    expect(decoder.push('   缩进内容\n')).toEqual(['   缩进内容']);
  });
});

describe('AnsiLineDecoder 编码', () => {
  it('多字节字符被块边界切开时不产生乱码', () => {
    const bytes = Buffer.from('正在安装 pi\n', 'utf-8');
    const decoder = new AnsiLineDecoder();

    expect(decoder.push(bytes.subarray(0, 5))).toEqual([]);
    expect(decoder.push(bytes.subarray(5))).toEqual(['正在安装 pi']);
  });

  it('flush 取出结尾没有分隔符的最后一段', () => {
    const decoder = new AnsiLineDecoder();
    decoder.push('a\nb');
    expect(decoder.flush()).toEqual(['b']);
  });

  it('flush 在缓冲为空时不返回内容', () => {
    const decoder = new AnsiLineDecoder();
    decoder.push('a\n');
    expect(decoder.flush()).toEqual([]);
  });
});
