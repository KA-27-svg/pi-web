import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configPaths,
  listConfiguredProviders,
  readJsonObject,
  resolveAgentDir,
  saveCustomProvider,
  saveDefaultModel,
  saveProviderKey,
  writeJsonObject,
} from './setupConfig';

let dir: string;
const models = () => path.join(dir, 'models.json');
const auth = () => path.join(dir, 'auth.json');
const settings = () => path.join(dir, 'settings.json');
const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf-8'));

// Windows 上 chmod 基本是空操作，权限断言只在 POSIX 上有意义
const posixOnly = process.platform === 'win32' ? it.skip : it;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-cfg-'));
});

afterEach(async () => {
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

describe('saveCustomProvider', () => {
  const config = {
    name: '我的中转站',
    baseUrl: 'https://relay.example/v1',
    api: 'openai-completions',
    models: [{ id: 'gpt-x' }, { id: 'claude-y' }],
  };

  it('新装一个自定义供应商', async () => {
    await saveCustomProvider('my-relay', config, dir);

    expect(await read(models())).toEqual({ providers: { 'my-relay': config } });
  });

  it('保留已有的供应商：用户可能手写过好几个中转站', async () => {
    await fs.writeFile(
      models(),
      JSON.stringify({ providers: { ollama: { baseUrl: 'http://localhost:11434/v1', models: [] } } })
    );

    await saveCustomProvider('my-relay', config, dir);

    const written = await read(models());
    expect(Object.keys(written.providers)).toEqual(['ollama', 'my-relay']);
    expect(written.providers.ollama.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('保留顶层其它字段', async () => {
    await fs.writeFile(models(), JSON.stringify({ 别的: 1 }));

    await saveCustomProvider('my-relay', config, dir);

    expect((await read(models())).别的).toBe(1);
  });

  it('providers 字段被写坏成数组时也不崩，直接重建', async () => {
    await fs.writeFile(models(), JSON.stringify({ providers: [1, 2] }));

    await saveCustomProvider('my-relay', config, dir);

    expect((await read(models())).providers['my-relay']).toEqual(config);
  });

  it('models.json 损坏时拒绝写入，且原文件不动', async () => {
    await fs.writeFile(models(), '{ 坏掉的');

    await expect(saveCustomProvider('my-relay', config, dir)).rejects.toThrow();
    expect(await fs.readFile(models(), 'utf-8')).toBe('{ 坏掉的');
  });
});
