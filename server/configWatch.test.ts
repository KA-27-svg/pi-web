import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configStamp, watchConfigFiles } from './configWatch';

describe('configStamp', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('文件改了（大小变了）指纹就变', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-watch-'));
    const file = path.join(dir, 'auth.json');

    await fs.writeFile(file, 'a');
    const before = await configStamp([file]);

    await fs.writeFile(file, 'bb');
    const after = await configStamp([file]);

    expect(after).not.toBe(before);
  });

  it('没动过就一样，缺文件也不抛错', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-watch-'));
    const present = path.join(dir, 'auth.json');
    await fs.writeFile(present, 'x');

    expect(await configStamp([present])).toBe(await configStamp([present]));
    await expect(configStamp([path.join(dir, 'nope.json')])).resolves.toBe('-');
  });
});

describe('watchConfigFiles', () => {
  it('第一次只记基线，之后变了才回调，且不重复报', async () => {
    vi.useFakeTimers();
    try {
      let stamp = 'a';
      const changes: string[] = [];
      watchConfigFiles({
        files: [],
        intervalMs: 1000,
        read: async () => stamp,
        onChange: () => changes.push(stamp),
      });

      // 首次 tick 记基线，不该报「刚变了」
      await vi.advanceTimersByTimeAsync(0);
      expect(changes).toEqual([]);

      stamp = 'b';
      await vi.advanceTimersByTimeAsync(1000);
      expect(changes).toEqual(['b']);

      // 没再变就不该重复刷新
      await vi.advanceTimersByTimeAsync(1000);
      expect(changes).toEqual(['b']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop 之后不再回调', async () => {
    vi.useFakeTimers();
    try {
      let stamp = 'a';
      const changes: string[] = [];
      const stop = watchConfigFiles({
        files: [],
        intervalMs: 1000,
        read: async () => stamp,
        onChange: () => changes.push(stamp),
      });

      await vi.advanceTimersByTimeAsync(0);
      stop();

      stamp = 'b';
      await vi.advanceTimersByTimeAsync(5000);
      expect(changes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
