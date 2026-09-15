import { describe, expect, it } from 'vitest';
import {
  buildPromptWithAttachments,
  formatBytes,
  readFileAsBase64,
} from './attachments';

describe('formatBytes', () => {
  it('小于 1 KB 直接显示字节', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('KB 及以上带单位，小数值保留一位', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(12_345)).toBe('12 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('非法值不显示 NaN', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('buildPromptWithAttachments', () => {
  it('没有附件时原样返回用户输入', () => {
    expect(buildPromptWithAttachments('你好', [])).toBe('你好');
  });

  it('附件路径排在正文之前，一行一个', () => {
    const built = buildPromptWithAttachments('总结一下', [
      '.pi-web-uploads/a.docx',
      '.pi-web-uploads/b.png',
    ]);

    expect(built).toBe(
      '[附件] .pi-web-uploads/a.docx\n[附件] .pi-web-uploads/b.png\n\n总结一下'
    );
  });

  it('用户没写正文时补一句，确保 agent 会去读', () => {
    const built = buildPromptWithAttachments('   ', ['.pi-web-uploads/a.docx']);

    expect(built).toContain('[附件] .pi-web-uploads/a.docx');
    expect(built).toMatch(/读取/);
  });

  it('忽略空路径', () => {
    expect(buildPromptWithAttachments('看下', ['', '.pi-web-uploads/a.txt'])).toBe(
      '[附件] .pi-web-uploads/a.txt\n\n看下'
    );
  });
});

describe('readFileAsBase64', () => {
  it('把文件读成 base64，二进制内容不失真', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    const encoded = await readFileAsBase64(new Blob([bytes]));

    expect(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))).toEqual(bytes);
  });

  it('超过分块大小也不会爆栈', async () => {
    // 逐字符 spread 的实现会在大文件上 RangeError，这里用 200KB 卡住它
    const big = new Uint8Array(200 * 1024).fill(65);
    const encoded = await readFileAsBase64(new Blob([big]));

    expect(atob(encoded).length).toBe(200 * 1024);
  });
});
