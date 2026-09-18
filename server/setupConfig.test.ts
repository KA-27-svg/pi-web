import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configPaths,
  deleteProvider,
  listConfiguredProviders,
  readAuthProviders,
  readJsonObject,
  readProviderBaseUrls,
  readProviderNames,
  resolveAgentDir,
  saveDefaultModel,
  saveProviderConfig,
  saveProviderKey,
  saveProviderName,
  writeJsonObject,
} from './setupConfig';

let dir: string;
let originalAgentDir: string | undefined;
const models = () => path.join(dir, 'models.json');
const auth = () => path.join(dir, 'auth.json');
const settings = () => path.join(dir, 'settings.json');
const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf-8'));

// Windows 上 chmod 基本是空操作，权限断言只在 POSIX 上有意义
const posixOnly = process.platform === 'win32' ? it.skip : it;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-cfg-'));
  // 隔离默认目录：万一某个调用漏传 agentDir，也只会写到临时目录，
  // 不会把测试数据（甚至假密钥）灌进用户真实的 ~/.pi/agent
  originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
});

afterEach(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveAgentDir', () => {
  it('默认是 ~/.pi/agent', () => {
    expect(resolveAgentDir({}, '/home/u')).toBe(path.join('/home/u', '.pi', 'agent'));
  });

  it('PI_CODING_AGENT_DIR 优先', () => {
    expect(resolveAgentDir({ PI_CODING_AGENT_DIR: '/custom/pi' }, '/home/u')).toBe('/custom/pi');
  });

  it('空字符串不算设置', () => {
    expect(resolveAgentDir({ PI_CODING_AGENT_DIR: '   ' }, '/home/u')).toBe(
      path.join('/home/u', '.pi', 'agent')
    );
  });

  it('三个配置文件都在配置目录下', () => {
    expect(configPaths('/pi')).toEqual({
      auth: path.join('/pi', 'auth.json'),
      models: path.join('/pi', 'models.json'),
      settings: path.join('/pi', 'settings.json'),
    });
  });
});

describe('readJsonObject', () => {
  it('文件不存在时返回空对象', async () => {
    expect(await readJsonObject(auth())).toEqual({});
  });

  it('空文件也返回空对象', async () => {
    await fs.writeFile(auth(), '   \n');
    expect(await readJsonObject(auth())).toEqual({});
  });

  it('正常读取', async () => {
    await fs.writeFile(auth(), JSON.stringify({ anthropic: { type: 'api_key', key: 'x' } }));
    expect(await readJsonObject(auth())).toEqual({ anthropic: { type: 'api_key', key: 'x' } });
  });

  it('内容损坏时抛错，而不是当作空对象', async () => {
    // 当成空对象就会把用户攒了很久的配置整体覆盖掉
    await fs.writeFile(auth(), '{ 这不是 JSON');

    await expect(readJsonObject(auth())).rejects.toThrow(/不是合法的 JSON/);
  });

  it('顶层是数组时也拒绝', async () => {
    await fs.writeFile(auth(), '[1,2,3]');
    await expect(readJsonObject(auth())).rejects.toThrow();
  });
});

describe('writeJsonObject', () => {
  it('自动建目录，并留下合法 JSON', async () => {
    const nested = path.join(dir, 'a', 'b', 'auth.json');
    await writeJsonObject(nested, { hello: 'world' });

    expect(await read(nested)).toEqual({ hello: 'world' });
  });

  it('写完不留临时文件', async () => {
    await writeJsonObject(auth(), { a: 1 });
    expect(await fs.readdir(dir)).toEqual(['auth.json']);
  });

  posixOnly('默认权限是 0600（文件里是凭证）', async () => {
    await writeJsonObject(auth(), { a: 1 });
    expect((await fs.stat(auth())).mode & 0o777).toBe(0o600);
  });

  posixOnly('已存在的宽权限文件会被改回来', async () => {
    await fs.writeFile(auth(), '{}', { mode: 0o644 });
    await writeJsonObject(auth(), { a: 1 });
    expect((await fs.stat(auth())).mode & 0o777).toBe(0o600);
  });
});

describe('saveProviderKey', () => {
  it('新装一个供应商', async () => {
    await saveProviderKey('anthropic', 'sk-ant-1', dir);

    expect(await read(auth())).toEqual({
      anthropic: { type: 'api_key', key: 'sk-ant-1' },
    });
  });

  it('保留已有条目：OAuth token 与别的供应商都不能被冲掉', async () => {
    await fs.writeFile(
      auth(),
      JSON.stringify({
        anthropic: { type: 'oauth', accessToken: 'keep-me' },
        deepseek: { type: 'api_key', key: 'old' },
      })
    );

    await saveProviderKey('openai', 'sk-1', dir);

    expect(await read(auth())).toEqual({
      anthropic: { type: 'oauth', accessToken: 'keep-me' },
      deepseek: { type: 'api_key', key: 'old' },
      openai: { type: 'api_key', key: 'sk-1' },
    });
  });

  it('支持带 baseUrl 的中转站', async () => {
    await saveProviderKey('custom', { type: 'api_key', key: 'k', baseUrl: 'https://x/v1' }, dir);

    expect(await read(auth())).toEqual({
      custom: { type: 'api_key', key: 'k', baseUrl: 'https://x/v1' },
    });
  });

  posixOnly('auth.json 权限是 0600', async () => {
    await saveProviderKey('anthropic', 'sk-ant-1', dir);
    expect((await fs.stat(auth())).mode & 0o777).toBe(0o600);
  });

  it('auth.json 损坏时拒绝写入，且原文件一字不动', async () => {
    await fs.writeFile(auth(), '{ 坏掉的');

    await expect(saveProviderKey('anthropic', 'sk-1', dir)).rejects.toThrow();
    expect(await fs.readFile(auth(), 'utf-8')).toBe('{ 坏掉的');
  });
});

describe('saveProviderConfig', () => {
  it('有 key 时照旧写 auth.json，并写名字', async () => {
    await saveProviderConfig({ provider: 'deepseek', key: 'sk-1', name: '我的中转站' }, dir, {});

    expect(await read(auth())).toEqual({ deepseek: { type: 'api_key', key: 'sk-1' } });
    expect(await readProviderNames(dir)).toEqual({ deepseek: '我的中转站' });
  });

  it('留空 key 只改名字：已配过的供应商不必重贴密钥', async () => {
    await fs.writeFile(auth(), JSON.stringify({ deepseek: { type: 'api_key', key: 'sk-old' } }));

    await saveProviderConfig({ provider: 'deepseek', key: '', name: '我的中转站' }, dir, {});

    expect(await read(auth())).toEqual({ deepseek: { type: 'api_key', key: 'sk-old' } });
    expect(await readProviderNames(dir)).toEqual({ deepseek: '我的中转站' });
  });

  it('只有环境变量也算已配置：留空 key 只改名字仍然可用', async () => {
    await saveProviderConfig({ provider: 'deepseek', key: '', name: '我的' }, dir, {
      DEEPSEEK_API_KEY: 'k',
    });

    expect(await readProviderNames(dir)).toEqual({ deepseek: '我的' });
  });

  it('没配过的供应商留空 key 会被拒绝', async () => {
    await expect(
      saveProviderConfig({ provider: 'deepseek', key: '', name: 'x' }, dir, {})
    ).rejects.toThrow(/API key/);
  });

  it('留空 key 改地址：合并到已有 api_key 上，密钥不动', async () => {
    await fs.writeFile(auth(), JSON.stringify({ deepseek: { type: 'api_key', key: 'sk-old' } }));

    await saveProviderConfig(
      { provider: 'deepseek', key: '', baseUrl: 'https://relay.example/v1', name: '' },
      dir,
      {}
    );

    expect(await read(auth())).toEqual({
      deepseek: { type: 'api_key', key: 'sk-old', baseUrl: 'https://relay.example/v1' },
    });
  });

  it('没有 api_key 时想改地址会被拒绝，不会凭空造一个半截凭证', async () => {
    await fs.writeFile(auth(), JSON.stringify({ anthropic: { type: 'oauth', refresh: 'r' } }));

    await expect(
      saveProviderConfig(
        { provider: 'anthropic', key: '', baseUrl: 'https://relay.example/v1', name: '' },
        dir,
        {}
      )
    ).rejects.toThrow(/API key/);
  });
});

describe('readProviderBaseUrls', () => {
  it('只取带 baseUrl 的中转供应商', async () => {
    await fs.writeFile(
      auth(),
      JSON.stringify({
        deepseek: { type: 'api_key', key: 'k', baseUrl: 'https://relay.example/v1' },
        openai: { type: 'api_key', key: 'k' },
        anthropic: { type: 'oauth', refresh: 'r' },
      })
    );

    expect(await readProviderBaseUrls(dir)).toEqual({
      deepseek: 'https://relay.example/v1',
    });
  });

  it('文件不存在或坏掉时返回空对象，不影响界面其余部分', async () => {
    expect(await readProviderBaseUrls(dir)).toEqual({});

    await fs.writeFile(auth(), '坏');
    expect(await readProviderBaseUrls(dir)).toEqual({});
  });
});

describe('deleteProvider', () => {
  it('删掉 auth.json 里那一条，保留别的', async () => {
    await fs.writeFile(
      auth(),
      JSON.stringify({
        anthropic: { type: 'oauth', refresh: 'r' },
        deepseek: { type: 'api_key', key: 'sk-1' },
      })
    );

    await deleteProvider('deepseek', dir);

    expect(await read(auth())).toEqual({ anthropic: { type: 'oauth', refresh: 'r' } });
  });

  it('顺手清掉显示名（空条目也删掉）', async () => {
    await fs.writeFile(auth(), JSON.stringify({ deepseek: { type: 'api_key', key: 'sk-1' } }));
    await fs.writeFile(models(), JSON.stringify({ providers: { deepseek: { name: '我的中转站' } } }));

    await deleteProvider('deepseek', dir);

    expect(await readProviderNames(dir)).toEqual({});
  });

  it('没配过的供应商：什么都不动，也不报错', async () => {
    await fs.writeFile(auth(), JSON.stringify({ anthropic: { type: 'api_key', key: 'k' } }));

    await deleteProvider('deepseek', dir);

    expect(await read(auth())).toEqual({ anthropic: { type: 'api_key', key: 'k' } });
  });

  it('auth.json 损坏时拒绝写入，且原文件一字不动', async () => {
    await fs.writeFile(auth(), '{ 坏掉的');

    await expect(deleteProvider('deepseek', dir)).rejects.toThrow();
    expect(await fs.readFile(auth(), 'utf-8')).toBe('{ 坏掉的');
  });
});

describe('readAuthProviders', () => {
  it('只报 auth.json 里存了凭证的，不含只设了环境变量的', async () => {
    // 环境变量删不掉，所以删除按钮只应该给这条列表里的供应商
    await fs.writeFile(auth(), JSON.stringify({ deepseek: { type: 'api_key', key: 'k' } }));

    expect(await readAuthProviders(dir)).toEqual(['deepseek']);
  });

  it('文件不存在或坏掉时返回空数组', async () => {
    expect(await readAuthProviders(dir)).toEqual([]);

    await fs.writeFile(auth(), '坏');
    expect(await readAuthProviders(dir)).toEqual([]);
  });
});

describe('saveProviderName', () => {
  it('清空名字时要真的写回文件，不能因为结果为空就跳过', async () => {
    await fs.writeFile(models(), JSON.stringify({ providers: { deepseek: { name: '我的中转站' } } }));

    await saveProviderName('deepseek', '', dir);

    expect(JSON.parse(await fs.readFile(models(), 'utf-8'))).toEqual({});
  });

  it('名字没变就不动文件', async () => {
    await fs.writeFile(models(), JSON.stringify({ providers: { deepseek: { name: '甲' } } }));
    const before = (await fs.stat(models())).mtimeMs;

    await saveProviderName('deepseek', '甲', dir);

    expect((await fs.stat(models())).mtimeMs).toBe(before);
  });
});

describe('saveDefaultModel', () => {
  it('记住默认模型，并保留用户已有的其它设置', async () => {
    await fs.writeFile(
      settings(),
      JSON.stringify({ theme: 'dark', lastChangelogVersion: '0.85.1' })
    );

    await saveDefaultModel('anthropic', 'claude-sonnet-4-20250514', dir);

    expect(await read(settings())).toEqual({
      theme: 'dark',
      lastChangelogVersion: '0.85.1',
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-20250514',
    });
  });
});

describe('listConfiguredProviders', () => {
  it('auth.json 里的键都算已配置', async () => {
    await fs.writeFile(auth(), JSON.stringify({ anthropic: {}, deepseek: {} }));

    expect(await listConfiguredProviders(dir, {})).toEqual(['anthropic', 'deepseek']);
  });

  it('只设了环境变量也算已配置', async () => {
    // 用户可能一直用 export ANTHROPIC_API_KEY，从没写过 auth.json
    expect(await listConfiguredProviders(dir, { ANTHROPIC_API_KEY: 'sk-ant' })).toEqual([
      'anthropic',
    ]);
  });

  it('文件与环境变量合并去重', async () => {
    await fs.writeFile(auth(), JSON.stringify({ anthropic: {} }));

    expect(
      await listConfiguredProviders(dir, { ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'k' })
    ).toEqual(['anthropic', 'google']);
  });

  it('auth.json 损坏时退回只看环境变量，而不是整个失败', async () => {
    await fs.writeFile(auth(), '坏');

    expect(await listConfiguredProviders(dir, { DEEPSEEK_API_KEY: 'k' })).toEqual(['deepseek']);
  });

  it('空环境变量不算配置', async () => {
    expect(await listConfiguredProviders(dir, { ANTHROPIC_API_KEY: '  ' })).toEqual([]);
  });
});
