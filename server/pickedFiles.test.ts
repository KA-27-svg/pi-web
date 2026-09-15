import { describe, expect, it } from 'vitest';
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
