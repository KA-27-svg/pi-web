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

/**
 * 在已有的 api_key 凭证上改地址，密钥不动。
 *
 * 没有 api_key（没配过、或是 OAuth 凭证）时拒绝：只改地址而不给密钥，
 * 等于凭空造一个半截凭证。
 */
export async function updateProviderBaseUrl(
  provider: string,
  baseUrl: string,
  agentDir: string = resolveAgentDir()
): Promise<void> {
  const { auth } = configPaths(agentDir);
  const existing = await readJsonObject(auth);

  const entry = existing[provider];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.type !== 'api_key') {
    throw new Error('这个供应商还没有 API key，请先填入密钥再改地址');
  }

  existing[provider] = { ...entry, baseUrl };
  await writeJsonObject(auth, existing, { mode: 0o600 });
}

export interface ProviderConfigInput {
  provider: string;
  /** 留空表示「不动已有密钥」，只更新地址 / 名字 */
  key?: string;
  baseUrl?: string;
  /** 显示名。空字符串 = 退回官方名字 */
  name: string;
}

/**
 * 保存一个供应商的凭证 / 地址 / 显示名。
 *
 * `key` 留空是允许的，前提是这个供应商已经配过（auth.json 或环境变量）：
 * 这样用户换个名字、改个地址时，不必把不回显的密钥再翻出来重贴一遍。
 */
export async function saveProviderConfig(
  input: ProviderConfigInput,
  agentDir: string = resolveAgentDir(),
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const provider = input.provider.trim();
  if (!provider) throw new Error('缺少供应商标识');

  const key = input.key?.trim() ?? '';
  const baseUrl = input.baseUrl?.trim() ?? '';

  if (key) {
    await saveProviderKey(
      provider,
      {
        type: 'api_key',
        key,
        ...(baseUrl ? { baseUrl } : {}),
      },
      agentDir
    );
  } else if (baseUrl) {
    await updateProviderBaseUrl(provider, baseUrl, agentDir);
  } else {
    // 什么都不更新的话，至少得是已经配过的，否则等于点了保存却没配任何东西
    const configured = await listConfiguredProviders(agentDir, env);
    if (!configured.includes(provider)) throw new Error('API key 不能为空');
  }

  await saveProviderName(provider, input.name, agentDir);
}

/**
 * pi 的 settings.json 里指定的 bash 路径。
 *
 * 读不到就返回 null（文件不存在、键没设、内容坏了都一样）：
 * 这只是「用户可能指定过」的额外线索，不该让整个环境探测失败。
 * 原因同 listConfiguredProviders：坏掉的配置只影响它自己那一项。
 */
export async function readShellPath(
  agentDir: string = resolveAgentDir()
): Promise<string | null> {
  const settings = await readJsonObject(configPaths(agentDir).settings).catch(
    () => ({}) as Record<string, any>
  );

  const value = settings.shellPath;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * pi 启动时启用的内置工具集。没配过时返回 null（= 用 pi 自己的默认）。
 *
 * 同样是「读不到就当没有」：坏掉的配置只影响这一项。
 */
export async function readDefaultTools(
  agentDir: string = resolveAgentDir()
): Promise<string[] | null> {
  const settings = await readJsonObject(configPaths(agentDir).settings).catch(
    () => ({}) as Record<string, any>
  );

  const value = settings.defaultTools;
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return null;
  return value as string[];
}

/**
 * 换掉 pi 启动时启用的内置工具集。
 *
 * 目前只有一处用它：Windows 上找不到 Git Bash 时把 `bash` 换成 `powershell`
 * （见 toolFallback.ts）。
 *
 * 同样是读改写：settings.json 里还躺着 defaultProvider / defaultModel / shellPath /
 * sessionDir 一堆键，整体覆盖一次就全没了。
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
 * 给供应商起个名字（写进 models.json 的 providers.<id>.name）。
 *
 * pi 的 models.json 支持给供应商一个显示名，界面上就用它。留空 = 删掉这个键，
 * 退回内置目录里的官方名字。
 *
 * 只碰 `name` 这一个键：那份文件里躺着用户手写的 models / compat / cost 等等，
 * 而且名字没变时直接返回不动文件。
 */
export async function saveProviderName(
  provider: string,
  name: string,
  agentDir: string = resolveAgentDir()
): Promise<void> {
  const { models } = configPaths(agentDir);
  const existing = await readJsonObject(models);

  const providers =
    existing.providers && typeof existing.providers === 'object' && !Array.isArray(existing.providers)
      ? (existing.providers as Record<string, any>)
      : {};

  const raw = providers[provider];
  const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};

  const current = typeof entry.name === 'string' ? entry.name : '';
  const next = name.trim();
  // 名字没变就别动用户的文件（它可能是手写的，重写一次虽然内容一样但 mtime 会变）
  if (current === next) return;

  if (next) entry.name = next;
  else delete entry.name;

  // 本来就没这个供应商、名字又清空了，那就什么也别留下
  if (Object.keys(entry).length === 0) delete providers[provider];
  else providers[provider] = entry;

  if (Object.keys(providers).length === 0) delete existing.providers;
  else existing.providers = providers;

  // 走到这里说明名字确实变了（没变在上面就 return 了）。即使结果是一片空白也要写：
  // 那是「把最后一条名字清掉」，不写的话旧名字会留在盘上。
  // （文件本来就不存在时 current === next === ''，上面已经返回过，不会来这儿凭空建文件）
  await writeJsonObject(models, existing, { mode: 0o600 });
}

/**
 * 供应商 id → 用户起的名字。没起过的不在里面。
 * 读不到就当没有：坏掉的配置不该让整个探测失败。
 */
export async function readProviderNames(
  agentDir: string = resolveAgentDir()
): Promise<Record<string, string>> {
  const settings = await readJsonObject(configPaths(agentDir).models).catch(
    () => ({}) as Record<string, any>
  );

  const providers = settings.providers;
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return {};

  const names: Record<string, string> = {};
  for (const [id, config] of Object.entries(providers as Record<string, any>)) {
    const name = config?.name;
    if (typeof name === 'string' && name.trim()) names[id] = name.trim();
  }
  return names;
}

/**
 * 某个供应商当前的 API 密钥。
 * 优先 auth.json 里的 api_key，没有再看等价的环境变量；都没有返回 null
 * （订阅登录的 OAuth token 不走这条路）。
 */
export async function readApiKey(
  provider: string,
  agentDir: string = resolveAgentDir()
): Promise<string | null> {
  const auth = await readJsonObject(configPaths(agentDir).auth).catch(
    () => ({}) as Record<string, any>
  );

  const entry = auth[provider];
  if (entry && typeof entry === 'object' && typeof entry.key === 'string' && entry.key.trim()) {
    return entry.key.trim();
  }

  const envVar = PROVIDER_ENV_VARS[provider];
  const fromEnv = envVar ? process.env[envVar]?.trim() : '';
  return fromEnv || null;
}

/**
 * auth.json 里存了凭证的供应商。
 * 与 listConfiguredProviders 不同：不含只设了环境变量的——那些删不掉（env 不归我们管），
 * 所以界面上的删除按钮只应该给这一份列表里的供应商。
 */
export async function readAuthProviders(
  agentDir: string = resolveAgentDir()
): Promise<string[]> {
  const auth = await readJsonObject(configPaths(agentDir).auth).catch(
    () => ({}) as Record<string, any>
  );
  return Object.keys(auth);
}

/**
 * 删掉一个供应商的凭证，并清掉它在 models.json 里的显示名。
 *
 * 只碰 auth.json 里的这一条和 models.json 里的 `name`：models.json 里可能躺着
 * 用户手写的 models / cost 等等，不能整条拿掉。文件坏掉时 readJsonObject 会抛错，
 * 拒绝写入。
 */
export async function deleteProvider(
  provider: string,
  agentDir: string = resolveAgentDir()
): Promise<void> {
  const { auth } = configPaths(agentDir);
  const existing = await readJsonObject(auth);
  if (!(provider in existing)) return;

  delete existing[provider];
  await writeJsonObject(auth, existing, { mode: 0o600 });

  // 显示名一并清掉（只碰 name；清完变空条目会被 saveProviderName 删掉）
  await saveProviderName(provider, '', agentDir);
}

/**
 * 供应商 id → 已配的中转地址（auth.json 里的 `baseUrl`）。
 *
 * 给表单回显用：不回显的话，用户只想换个 key，地址那一栏是空的，一提交就被覆盖没了。
 * 只读 baseUrl，不碰 key。读不到就当没有。
 */
export async function readProviderBaseUrls(
  agentDir: string = resolveAgentDir()
): Promise<Record<string, string>> {
  const auth = await readJsonObject(configPaths(agentDir).auth).catch(
    () => ({}) as Record<string, any>
  );

  const urls: Record<string, string> = {};
  for (const [id, entry] of Object.entries(auth)) {
    const baseUrl = (entry as { baseUrl?: unknown } | null)?.baseUrl;
    if (typeof baseUrl === 'string' && baseUrl.trim()) urls[id] = baseUrl.trim();
  }
  return urls;
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
