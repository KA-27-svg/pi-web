import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_PREFS, parsePrefs, readPrefs, writePrefs } from './piWebPrefs';

describe('parsePrefs', () => {
  it('只有明确为 true 才算开启', () => {
    expect(parsePrefs({ readOnly: true })).toEqual({ readOnly: true });
    expect(parsePrefs({ readOnly: false })).toEqual({ readOnly: false });
  });

  it('字段缺失或类型不对时回退到默认值，而不是崩掉', () => {
    expect(parsePrefs({})).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ readOnly: 'true' })).toEqual({ readOnly: false });
    expect(parsePrefs({ readOnly: 1 })).toEqual({ readOnly: false });
  });

  it('能容忍文件里有未来才认识的字段', () => {
    expect(parsePrefs({ readOnly: true, somethingNew: 42 })).toEqual({ readOnly: true });
  });
});

describe('读写偏好文件', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-prefs-'));
    file = path.join(dir, 'prefs.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('文件不存在时用默认值', async () => {
    await expect(readPrefs(file)).resolves.toEqual(DEFAULT_PREFS);
  });

  it('写进去再读回来是同一个值', async () => {
    await writePrefs({ readOnly: true }, file);
    await expect(readPrefs(file)).resolves.toEqual({ readOnly: true });

    await writePrefs({ readOnly: false }, file);
    await expect(readPrefs(file)).resolves.toEqual({ readOnly: false });
  });

  it('文件坏掉时退回默认值，不让桥接起不来', async () => {
    await fs.writeFile(file, '{ 这不是 json', 'utf-8');
    await expect(readPrefs(file)).resolves.toEqual(DEFAULT_PREFS);
  });
});
