import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_INSTRUCTION,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  TRUNCATED_NOTE,
  baseName,
  buildPromptWithAttachments,
  fileKind,
  formatBytes,
  isImageFile,
  isSendableAttachment,
  parseFileAttachments,
  planImageResize,
  prepareImageAttachment,
  readFileAsBase64,
} from './attachments';

/** 只关心路径的文件附件 */
const file = (p: string) => ({ name: p, path: p });

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
      file('.pi-web-uploads/a.docx'),
      file('.pi-web-uploads/b.png'),
    ]);

    expect(built).toBe(
      '[附件] .pi-web-uploads/a.docx\n[附件] .pi-web-uploads/b.png\n\n总结一下'
    );
  });

  it('用户没写正文时补一句，确保 agent 会去读', () => {
    const built = buildPromptWithAttachments('   ', [file('.pi-web-uploads/a.docx')]);

    expect(built).toContain('[附件] .pi-web-uploads/a.docx');
    expect(built).toContain(ATTACHMENT_INSTRUCTION);
  });

  it('忽略空路径', () => {
    expect(buildPromptWithAttachments('看下', [file(''), file('.pi-web-uploads/a.txt')])).toBe(
      '[附件] .pi-web-uploads/a.txt\n\n看下'
    );
  });

  it('有内容的文本文件直接内联，模型不必先去 read', () => {
    const built = buildPromptWithAttachments('解释一下', [
      { name: 'a.ts', path: 'src/a.ts', content: 'export const a = 1;\n' },
    ]);

    expect(built).toBe('[附件] src/a.ts\n```\nexport const a = 1;\n\n```\n\n解释一下');
  });

  it('内容里本来就有围栏时，用更长的围栏包住它', () => {
    const content = '看这段：\n```ts\nlet a = 1\n```\n';

    const built = buildPromptWithAttachments('', [
      { name: 'a.md', path: 'a.md', content },
    ]);

    // 否则文件里的 ``` 会提前把我们的围栏关掉
    expect(built).toContain('````');
    expect(built).toContain(content);
  });

  it('内容被截断时明确告知，避免模型对剩下的内容瞎猜', () => {
    const built = buildPromptWithAttachments('', [
      { name: 'a.log', path: 'a.log', content: 'head', truncated: true },
    ]);

    expect(built).toContain(TRUNCATED_NOTE);
  });
});

describe('isImageFile', () => {
  it('按 MIME 判断图片', () => {
    expect(isImageFile(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isImageFile(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(false);
  });

  it('拿不到 MIME 时当作普通文件', () => {
    expect(isImageFile(new File(['x'], 'a'))).toBe(false);
  });
});

describe('fileKind', () => {
  it('代码、脚本与配置文件归为 code', () => {
    for (const name of ['a.ts', 'b.tsx', 'c.py', 'd.sh', 'e.yaml', 'f.sql', 'g.css']) {
      expect(fileKind(name), name).toBe('code');
    }
  });

  it('json 单独一类，因为图标不一样', () => {
    expect(fileKind('package.json')).toBe('json');
    expect(fileKind('events.jsonl')).toBe('json');
  });

  it('文档、表格、演示分开', () => {
    expect(fileKind('报告.docx')).toBe('doc');
    expect(fileKind('说明.pdf')).toBe('doc');
    expect(fileKind('readme.md')).toBe('doc');
    expect(fileKind('数据.xlsx')).toBe('sheet');
    expect(fileKind('数据.csv')).toBe('sheet');
    expect(fileKind('汇报.pptx')).toBe('slide');
  });

  it('压缩包、音视频、图片各自一类', () => {
    expect(fileKind('a.zip')).toBe('archive');
    expect(fileKind('a.7z')).toBe('archive');
    expect(fileKind('a.mp3')).toBe('audio');
    expect(fileKind('a.mp4')).toBe('video');
    expect(fileKind('a.png')).toBe('image');
  });

  it('大写扩展名也认得', () => {
    expect(fileKind('报告.DOCX')).toBe('doc');
    expect(fileKind('Photo.PNG')).toBe('image');
  });

  it('没有扩展名或认不出来就归到 other', () => {
    expect(fileKind('LICENSE')).toBe('other');
    expect(fileKind('a.weirdext')).toBe('other');
    expect(fileKind('')).toBe('other');
  });

  it('只认最后一个点，带点的名字不会认错', () => {
    expect(fileKind('我的.报告.final.docx')).toBe('doc');
    expect(fileKind('archive.tar.gz')).toBe('archive');
  });
});

describe('baseName', () => {
  it('正斜杠与反斜杠都能取到文件名', () => {
    expect(baseName('.pi-web-uploads/a.docx')).toBe('a.docx');
    expect(baseName('C:\\work\\.pi-web-uploads\\报告.pdf')).toBe('报告.pdf');
  });
});

describe('parseFileAttachments', () => {
  it('取出附件路径，并把那几行从正文里去掉', () => {
    const parsed = parseFileAttachments('[附件] .pi-web-uploads/a.docx\n\n帮我总结');

    expect(parsed.paths).toEqual(['.pi-web-uploads/a.docx']);
    expect(parsed.text).toBe('帮我总结');
  });

  it('多个附件都能取回', () => {
    const parsed = parseFileAttachments(
      '[附件] .pi-web-uploads/a.txt\n[附件] .pi-web-uploads/b.pdf\n看下这两个'
    );

    expect(parsed.paths).toEqual(['.pi-web-uploads/a.txt', '.pi-web-uploads/b.pdf']);
    expect(parsed.text).toBe('看下这两个');
  });

  it('没有附件的消息原样返回', () => {
    const parsed = parseFileAttachments('普通消息\n第二行');

    expect(parsed.paths).toEqual([]);
    expect(parsed.text).toBe('普通消息\n第二行');
  });

  it('只有附件时正文为空，不会把自动补的那句话显示出来', () => {
    const parsed = parseFileAttachments(
      `[附件] .pi-web-uploads/a.docx\n\n${ATTACHMENT_INSTRUCTION}`
    );

    expect(parsed.paths).toHaveLength(1);
    expect(parsed.text).toBe('');
  });

  it('正文里恰好提到附件字样但格式不对时不受影响', () => {
    const parsed = parseFileAttachments('我说的附件 是这个词');

    expect(parsed.paths).toEqual([]);
    expect(parsed.text).toBe('我说的附件 是这个词');
  });

  it('内联进来的文件内容会被丢掉，不重复铺在气泡里', () => {
    const wire = buildPromptWithAttachments('看看', [
      { name: 'a.ts', path: 'src/a.ts', content: 'export const a = 1;\n' },
    ]);

    const parsed = parseFileAttachments(wire);

    expect(parsed.paths).toEqual(['src/a.ts']);
    expect(parsed.text).toBe('看看');
    expect(parsed.text).not.toContain('export const');
  });

  it('内容里带着围栏的也能完整丢掉', () => {
    const content = '```ts\nlet a = 1\n```\n';
    const wire = buildPromptWithAttachments('', [
      { name: 'a.md', path: 'a.md', content },
    ]);

    const parsed = parseFileAttachments(wire);

    expect(parsed.paths).toEqual(['a.md']);
    expect(parsed.text).toBe('');
  });

  it('截断提示也一并丢掉', () => {
    const wire = buildPromptWithAttachments('', [
      { name: 'a.log', path: 'a.log', content: 'head', truncated: true },
    ]);

    const parsed = parseFileAttachments(wire);

    expect(parsed.paths).toEqual(['a.log']);
    expect(parsed.text).not.toContain(TRUNCATED_NOTE);
  });

  it('多个文件里有的内联有的只给路径，都能还原', () => {
    const wire = buildPromptWithAttachments('一起看', [
      { name: 'a.ts', path: 'a.ts', content: 'let a = 1\n' },
      { name: 'b.pdf', path: 'b.pdf' },
    ]);

    const parsed = parseFileAttachments(wire);

    expect(parsed.paths).toEqual(['a.ts', 'b.pdf']);
    expect(parsed.text).toBe('一起看');
  });
});

describe('prepareImageAttachment', () => {
  it('产出 data URL 和原始 base64', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    const prepared = await prepareImageAttachment(file);

    expect(prepared.mimeType).toBe('image/png');
    expect(prepared.dataUrl).toBe(`data:image/png;base64,${prepared.data}`);
    expect(Uint8Array.from(atob(prepared.data), c => c.charCodeAt(0))).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });

  it('读不出尺寸的环境（Node）下，超大图只能请你先压缩', async () => {
    const huge = new File([new Uint8Array(MAX_IMAGE_BYTES + 10)], 'big.png', {
      type: 'image/png',
    });

    await expect(prepareImageAttachment(huge)).rejects.toThrow(/压缩/);
  });
});

describe('planImageResize', () => {
  const small = 200 * 1024;

  it('尺寸和体积都合规就原样发，不重编码', () => {
    // 重编码会掉画质、丢动画、丢透明，能不动就不动
    expect(planImageResize(1200, 800, small)).toEqual({
      width: 1200,
      height: 800,
      reencode: false,
    });
  });

  it('最长边超限就按比例缩，短边跟着走', () => {
    expect(planImageResize(4000, 3000, small)).toEqual({
      width: 2000,
      height: 1500,
      reencode: true,
    });
  });

  it('横图按宽度算，竖图按高度算', () => {
    expect(planImageResize(8000, 2000, small)).toMatchObject({ width: 2000, height: 500 });
    expect(planImageResize(2000, 8000, small)).toMatchObject({ width: 500, height: 2000 });
  });

  it('尺寸合规但体积超限也要重编码（尺寸不变）', () => {
    expect(planImageResize(1200, 800, MAX_IMAGE_BYTES + 1)).toEqual({
      width: 1200,
      height: 800,
      reencode: true,
    });
  });

  it('已经是上限尺寸时不缩', () => {
    expect(planImageResize(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE, small).reencode).toBe(false);
  });

  it('极端长条图不会缩出 0 像素', () => {
    const plan = planImageResize(1, 9000, small);
    expect(plan.width).toBeGreaterThanOrEqual(1);
    expect(plan.height).toBe(MAX_IMAGE_EDGE);
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

describe('isSendableAttachment', () => {
  it('图片要有 base64 与 MIME 才算能发', () => {
    expect(
      isSendableAttachment({ id: '1', name: 'a.png', bytes: 1, kind: 'image', status: 'ready', data: 'x', mimeType: 'image/png' })
    ).toBe(true);
    expect(
      isSendableAttachment({ id: '1', name: 'a.png', bytes: 1, kind: 'image', status: 'ready' })
    ).toBe(false);
  });

  it('文件要有路径或内联内容才算能发', () => {
    expect(
      isSendableAttachment({ id: '1', name: 'a.ts', bytes: 1, kind: 'file', status: 'ready', path: 'a.ts' })
    ).toBe(true);
    expect(
      isSendableAttachment({ id: '1', name: 'a.ts', bytes: 1, kind: 'file', status: 'ready', content: 'x' })
    ).toBe(true);
    expect(
      isSendableAttachment({ id: '1', name: 'a.ts', bytes: 1, kind: 'file', status: 'ready' })
    ).toBe(false);
  });

  it('没 ready 的一律不能发', () => {
    expect(
      isSendableAttachment({ id: '1', name: 'a.ts', bytes: 1, kind: 'file', status: 'loading', path: 'a.ts' })
    ).toBe(false);
    expect(
      isSendableAttachment({ id: '1', name: 'a.ts', bytes: 1, kind: 'file', status: 'error', path: 'a.ts' })
    ).toBe(false);
  });
});
