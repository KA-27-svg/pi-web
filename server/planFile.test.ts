import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PLAN_DIR, planTitle, resolvePlanPath, savePlan, slugify, stamp } from './planFile';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-plan-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('slugify', () => {
  it('普通标题变成连字符文件名', () => {
    expect(slugify('Assistant Mode Plan')).toBe('assistant-mode-plan');
    expect(slugify('  a  b  ')).toBe('a-b');
  });

  it('中文照留（文件名里可读比全英文有用）', () => {
    expect(slugify('助手模式 方案')).toBe('助手模式-方案');
  });

  it('不可能拼出路径分隔符或 ..', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('..')).toBe('plan');
    expect(slugify('a\\b')).toBe('a-b');
    expect(slugify('.')).toBe('plan');
  });

  it('全被滤掉时退回 plan', () => {
    expect(slugify('★☆★')).toBe('plan');
    expect(slugify('')).toBe('plan');
  });

  it('长度收在 40 以内，且不以连字符收尾', () => {
    const long = slugify('a'.repeat(80));
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('-')).toBe(false);
  });
});

describe('planTitle', () => {
  it('优先取 markdown 标题', () => {
    expect(planTitle('先说明\n\n# 真正的标题\n正文')).toBe('真正的标题');
    expect(planTitle('## 二级也行')).toBe('二级也行');
  });

  it('没有标题就取第一行（去掉列表符号）', () => {
    expect(planTitle('- 做一件事\n- 再做一件')).toBe('做一件事');
    expect(planTitle('就这么干')).toBe('就这么干');
    expect(planTitle('')).toBe('');
  });
});

describe('stamp', () => {
  it('本地时间、补零到位', () => {
    expect(stamp(new Date(2025, 8, 1, 4, 30))).toBe('20250901-0430');
  });
});

describe('resolvePlanPath 的路径守卫', () => {
  it('正常文件名落在 docs/plans 下', () => {
    expect(resolvePlanPath('/proj', 'a.md')).toBe(path.resolve('/proj', 'docs', 'plans', 'a.md'));
  });

  it('越出计划目录一律拒绝', () => {
    expect(() => resolvePlanPath('/proj', '../evil.md')).toThrow(/越出/);
    expect(() => resolvePlanPath('/proj', '../../evil.md')).toThrow(/越出/);
    expect(() => resolvePlanPath('/proj', 'sub/../../evil.md')).toThrow(/越出/);
    expect(() => resolvePlanPath('/proj', path.resolve('/tmp/evil.md'))).toThrow(/越出/);
  });
});

describe('savePlan', () => {
  const now = new Date(2025, 8, 1, 4, 30);

  it('建目录、写文件、返回可直接写进消息的相对路径', async () => {
    const result = await savePlan(root, { text: '# 方案\n\n就这么干' }, now);

    expect(result.relative).toBe(`${PLAN_DIR}/20250901-0430-方案.md`);
    expect(result.absolute).toBe(path.resolve(root, 'docs', 'plans', '20250901-0430-方案.md'));
    await expect(fs.readFile(result.absolute, 'utf-8')).resolves.toBe('# 方案\n\n就这么干\n');
  });

  it('正文末尾没有换行时补一个', async () => {
    const result = await savePlan(root, { text: 'x' }, now);
    await expect(fs.readFile(result.absolute, 'utf-8')).resolves.toBe('x\n');
  });

  it('同一分钟里重名就加序号，不覆盖前一份', async () => {
    const first = await savePlan(root, { text: '第一版', title: '方案' }, now);
    const second = await savePlan(root, { text: '第二版', title: '方案' }, now);

    expect(first.relative).toBe(`${PLAN_DIR}/20250901-0430-方案.md`);
    expect(second.relative).toBe(`${PLAN_DIR}/20250901-0430-方案-2.md`);
    await expect(fs.readFile(first.absolute, 'utf-8')).resolves.toBe('第一版\n');
    await expect(fs.readFile(second.absolute, 'utf-8')).resolves.toBe('第二版\n');
  });

  it('空内容拒绝写', async () => {
    await expect(savePlan(root, { text: '   \n  ' })).rejects.toThrow(/为空/);
  });

  it('工作目录还不存在时也能建出来', async () => {
    const nested = path.join(root, 'not', 'yet');
    const result = await savePlan(nested, { text: 'x' }, now);

    await expect(fs.readFile(result.absolute, 'utf-8')).resolves.toBe('x\n');
  });
});
