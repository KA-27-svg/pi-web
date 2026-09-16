import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PROVIDER_ENV_VARS } from './providers.js';

/**
 * 读写 pi 的配置文件。
 *
 * 起因：pi 没有配置类 RPC（`/login` 是纯 TUI 流程），但配置就是几个 JSON 文件，
 * 而桥接就在同一台机器上——所以「在网页里填 API key」只能由桥接直接写文件。
 * 这已经是桥接在做的事（它一直在直接读写会话文件）。
 *
 * 两条底线：
 *  - **读改写**。auth.json 里可能躺着用户的 OAuth token 和别的供应商，
 *    整体覆盖一次就等于让他重新配一遍。
 *  - **坏了就停**。文件内容不是合法 JSON 时抛错，绝不静默当成空对象覆盖。
 */

export interface ConfigPaths {
  auth: string;
  models: string;
  settings: string;
}

/** pi 的配置目录。PI_CODING_AGENT_DIR 可覆盖，默认 ~/.pi/agent */
export function resolveAgentDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = os.homedir()
): string {
  const override = env.PI_CODING_AGENT_DIR?.trim();
  if (override) return override;

  return path.join(homedir, '.pi', 'agent');
}

export function configPaths(agentDir: string = resolveAgentDir()): ConfigPaths {
  return {
    auth: path.join(agentDir, 'auth.json'),
    models: path.join(agentDir, 'models.json'),
    settings: path.join(agentDir, 'settings.json'),
  };
}

/**
 * 读一个 JSON 配置对象。
 * 不存在或为空返回空对象；内容损坏则抛错（见文件头注释）。
 */
export async function readJsonObject(file: string): Promise<Record<string, any>> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }

  if (!raw.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${file} 不是合法的 JSON，已停止写入以免覆盖你现有的配置`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} 的内容不是一个 JSON 对象，已停止写入`);
  }

  return parsed as Record<string, any>;
}

/**
 * 原子写入 JSON 对象。
 *
 * 先写同目录的临时文件再 rename：中途失败不会留下半个文件。auth.json 里是凭证，
 * 写坏一次用户就得重新配一遍。默认 0600——这些文件里可能有密钥。
 */
export async function writeJsonObject(
  file: string,
  value: unknown,
  options: { mode?: number } = {}
): Promise<void> {
  const mode = options.mode ?? 0o600;
  await fs.mkdir(path.dirname(file), { recursive: true });

  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode });
  await fs.rename(temp, file);

  // mode 只在创建文件时生效，已存在的文件必须显式改回来
  await fs.chmod(file, mode);
}

export interface ProviderCredential {
  type: 'api_key';
  key: string;
  baseUrl?: string;
}

/** 写入一个供应商的凭证。读改写，保留其它条目 */
export async function saveProviderKey(
  provider: string,
  credential: string | ProviderCredential,
  agentDir: string = resolveAgentDir()
): Promise<void> {
  const { auth } = configPaths(agentDir);
  const existing = await readJsonObject(auth);

  existing[provider] =
    typeof credential === 'string' ? { type: 'api_key', key: credential } : credential;

  await writeJsonObject(auth, existing, { mode: 0o600 });
}

/** 记住启动时用的默认模型 */
export async function saveDefaultModel(
  provider: string,
  modelId: string,
  agentDir: string = resolveAgentDir()
): Promise<void> {
  const { settings } = configPaths(agentDir);
  const existing = await readJsonObject(settings);

  existing.defaultProvider = provider;
  existing.defaultModel = modelId;

  await writeJsonObject(settings, existing);
}

/**
 * 写默认工具集。
 * 用于 Windows 上绕开 Git Bash：把 bash 换成 powershell，就一个字节都不用下载。
 */
export async function saveDefaultTools(
  tools: string[],
  agentDir: string = resolveAgentDir()
): Promise<void> {
  const { settings } = configPaths(agentDir);
  const existing = await readJsonObject(settings);

  existing.defaultTools = tools;

  await writeJsonObject(settings, existing);
}

/**
 * 已经配了凭证的供应商。
 *
 * 两种来源都算：auth.json 里的键，以及设了对应环境变量的供应商——
 * 有人一直用 `export ANTHROPIC_API_KEY`，从没写过 auth.json。
 * auth.json 坏掉时只退回环境变量，不能让整个探测失败。
 */
export async function listConfiguredProviders(
  agentDir: string = resolveAgentDir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  const auth = await readJsonObject(configPaths(agentDir).auth).catch(() => ({}) as Record<string, any>);

  const providers = new Set(Object.keys(auth));
  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_VARS)) {
    if (env[envVar]?.trim()) providers.add(provider);
  }

  return [...providers];
}
