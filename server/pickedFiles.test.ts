import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MAX_REMEMBERED, PickedFiles } from './pickedFiles';

const abs = (...parts: string[]) => path.resolve(...parts);

describe('PickedFiles', () => {
  it('记住选过的路径', () => {
    const picked = new PickedFiles();
    picked.remember([abs('C:/Users/me/Desktop/a.png')]);

    expect(picked.allows(abs('C:/Users/me/Desktop/a.png'))).toBe(true);
    expect(picked.allows(abs('C:/Users/me/Desktop/b.png'))).toBe(false);
  });

  it('没选过的绝对路径一律不放行', () => {
    // 这条是安全边界：没有它，read_attachment 就等于任意文件读取
    const picked = new PickedFiles();

    expect(picked.allows(abs('C:/Windows/System32/config/SAM'))).toBe(false);
    expect(picked.allows(abs('C:/Users/me/.ssh/id_rsa'))).toBe(false);
  });

  it('路径写法不同但指向同一个文件也算', () => {
    const picked = new PickedFiles();
    picked.remember([abs('C:/Users/me/a.txt')]);

    expect(picked.allows(path.join(abs('C:/Users/me'), '.', 'a.txt'))).toBe(true);
  });

  it('超过上限时淘汰最早的，保留最近的', () => {
    const picked = new PickedFiles();
    const many = Array.from({ length: MAX_REMEMBERED + 10 }, (_, i) => abs(`C:/tmp/f${i}.txt`));

    picked.remember(many);

    expect(picked.size).toBe(MAX_REMEMBERED);
    expect(picked.allows(many[many.length - 1])).toBe(true);
    expect(picked.allows(many[0])).toBe(false);
  });

  it('重复记住同一个路径不会撑大集合', () => {
    const picked = new PickedFiles();
    const file = abs('C:/tmp/a.txt');

    picked.remember([file, file, file]);

    expect(picked.size).toBe(1);
  });
});

describe('PickedFiles 持久化', () => {
  let dir: string;
  let store: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-picked-'));
    store = path.join(dir, 'picked.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('重启后还能认得之前选过的文件', async () => {
    // 历史消息里的附件会在很多天后被点击，所以必须落盘
    const first = new PickedFiles(store);
    first.remember([abs('C:/Users/me/Desktop/报告.docx')]);
    await new Promise(resolve => setTimeout(resolve, 50)); // 等落盘

    const second = new PickedFiles(store);
    await second.load();

    expect(second.allows(abs('C:/Users/me/Desktop/报告.docx'))).toBe(true);
    expect(second.allows(abs('C:/Users/me/Desktop/别的.docx'))).toBe(false);
  });

  it('没给存储路径时就是纯内存的，不报错', async () => {
    const picked = new PickedFiles();
    await picked.load();
    picked.remember([abs('C:/tmp/a.txt')]);
    expect(picked.allows(abs('C:/tmp/a.txt'))).toBe(true);
  });

  it('记录文件不存在时当作空名单', async () => {
    const picked = new PickedFiles(path.join(dir, 'nope.json'));
    await expect(picked.load()).resolves.toBeUndefined();
    expect(picked.size).toBe(0);
  });

  it('记录文件坏掉时不会抛错，也不会放行任何路径', async () => {
    await fs.writeFile(store, '这不是 json', 'utf-8');

    const picked = new PickedFiles(store);
    await picked.load();

    expect(picked.size).toBe(0);
    expect(picked.allows(abs('C:/tmp/a.txt'))).toBe(false);
  });
});
