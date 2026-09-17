import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { listSessions, readSessionCwdSync, renameSession } from './sessions.js';
import { saveUpload } from './uploads.js';
import { listDirectory } from './browse.js';
import { pickFiles } from './fileDialog.js';
import { PickedFiles, pickedFilesStorePath } from './pickedFiles.js';
import { ATTACHMENT_PREFIX, attachmentPathsInMessages } from './attachmentPaths.js';
import { openWithSystem } from './openFile.js';
import { readAttachment, resolveAttachment } from './textAttachment.js';
import { reply } from './reply.js';
import { attachOriginGuard, parseAllowedOrigins } from './origin.js';
import { createStaticHandler } from './static.js';
import { defaultRunCommand, probeEnvironment, type SetupStatus } from './env.js';
import { createPiLocator } from './piLocate.js';
import {
  buildInstallCommand,
  classifyInstallOutcome,
  installPreflight,
  runInstall,
} from './piInstall.js';
import { PROVIDER_PRESETS, SUBSCRIPTION_LOGINS } from './providers.js';
import { findGitBash } from './gitBash.js';
import { planToolFallback } from './toolFallback.js';
import {
  listConfiguredProviders,
  readDefaultTools,
  readProviderNames,
  readShellPath,
  saveCustomProvider,
  saveDefaultModel,
  saveDefaultTools,
  saveProviderKey,
  saveProviderName,
} from './setupConfig.js';
import { fetchProviderModels, normalizeBaseUrl, SUPPORTED_APIS } from './customProvider.js';
import { PiSupervisor } from './pi.js';
import {
  emptyTrash,
  listTrash,
  purgeSession,
  restoreSession,
  sweepTrash,
  trashSession,
} from './trash.js';

const PORT = 3001;
// 桥接能以任意 cwd 拉起 `pi --mode rpc`，等同于把本机命令执行能力开放出去，
// 因此默认只监听回环地址，确有跨设备需求时再用环境变量显式放开。
const HOST = process.env.PI_BRIDGE_HOST || '127.0.0.1';

/** 构建产物目录。有它就不需要再开一个 Vite 进程 */
const DIST_DIR = path.resolve(process.cwd(), 'dist');
const serveStatic = createStaticHandler({ root: DIST_DIR });

/** dist 还没构建时给人话，而不是白屏 404 */
function notBuiltPage(): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>Pi Web</title>
<style>
  body { margin:0; display:flex; min-height:100vh; align-items:center; justify-content:center;
         background:#fcfcfb; color:#1c1c1a; font:14px/1.8 system-ui, -apple-system, "Segoe UI", sans-serif }
  main { max-width: 34rem; padding: 2rem }
  h1 { font-size: 15px; font-weight: 500; margin: 0 0 .5rem }
  code { background:#f1f1ee; padding:.1rem .35rem; border-radius:4px; font-size:12.5px }
  p { color:#8b8b85; margin:.5rem 0 }
  pre { background:#f5f5f2; border:1px solid #e9e9e5; border-radius:8px; padding:.75rem .9rem; overflow-x:auto; font-size:12.5px }
</style>
<main>
  <h1>前端还没构建</h1>
  <p>桥接已经在跑了，只是 <code>dist/</code> 不存在。</p>
  <pre>npm start</pre>
  <p>这条命令会先构建再启动，之后直接访问本页即可。</p>
  <p>开发时改用 <code>npm run dev</code>，页面在 <code>http://localhost:5173</code>。</p>
</main>`;
}

/**
 * HTTP：健康检查 + 托管构建好的前端。
 *
 * 这样生产模式只剩一个进程、一个端口——而 `origin.ts` 的白名单本来就已经放行
 * `http://127.0.0.1:3001`，所以不用动安全策略。
 */
async function handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = (req.url ?? '/').split('?')[0] ?? '/';

  if (urlPath === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', name: 'pi-web-bridge' }));
    return;
  }

  if (await serveStatic(req, res)) return;

  // 没扩展名的路径在前端是路由，这里只可能是 dist 没构建
  if (req.method === 'GET' && !path.extname(urlPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(notBuiltPage());
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

const server = http.createServer((req, res) => {
  void handleHttp(req, res).catch(err => {
    console.error('[Pi Bridge] HTTP 请求处理失败:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Error');
  });
});

// noServer + 自己处理 upgrade：握手阶段要校验 Origin。
// 少了它，浏览器里打开的任何网页都能连上桥接执行本机命令（CSWSH）。
const wss = new WebSocketServer({ noServer: true });
attachOriginGuard(server, wss, parseAllowedOrigins());

let currentCwd = process.cwd();
/**
 * 刚请求切换到的会话的工作目录。
 * pi 的 switch_session 会连带把工作目录换掉，但那个 cwd 只存在会话文件里，
 * RPC 的 get_state 也不返回它，所以桥接自己在转发前读出来，等 pi 确认成功后再应用。
 */
let pendingSwitchCwd: string | null = null;

/** 用户亲手选过的文件路径（工作目录之外的只允许读/打开这些） */
const picked = new PickedFiles(pickedFilesStorePath());

function broadcast(msg: string) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

/**
 * 从 pi 回传的会话内容里认领附件路径。
 *
 * 这是「附件能不能被打开」的第三种依据，也是最可靠的一种：用户确实把
 * `C:\...\报告.docx` 贴进过这个对话，他想点开它再自然不过。
 *
 * 不这么做的话，换个工作目录或重启一次桥接，历史里所有工作目录外的附件
 * 就全失效了——白名单是易失的，而转录里的事实是稳定的。
 */
function claimAttachments(line: string) {
  if (!line.includes('get_messages') || !line.includes(ATTACHMENT_PREFIX)) return;

  try {
    const message = JSON.parse(line);
    if (message?.type !== 'response' || message.command !== 'get_messages') return;

    const paths = attachmentPathsInMessages(message.data?.messages);
    if (paths.length > 0) picked.remember(paths);
  } catch {
    // 不是完整 JSON，忽略
  }
}

/**
 * pi 确认会话切换成功后，把桥接的 currentCwd 一并换掉。
 * 失败或被扩展取消时 pi 的工作目录没变，必须保持原样。
 */
function applyPendingSwitch(line: string) {
  if (!pendingSwitchCwd || !line.includes('switch_session')) return;

  let message: any;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message?.type !== 'response' || message.command !== 'switch_session') return;

  if (!message.success || message.data?.cancelled) {
    pendingSwitchCwd = null;
    return;
  }

  currentCwd = pendingSwitchCwd;
  pendingSwitchCwd = null;
  console.log(`[Pi Bridge] Session switch moved cwd to: ${currentCwd}`);
  broadcast(JSON.stringify({ type: 'cwd_changed', cwd: currentCwd }));
}

/**
 * pi 子进程的持有者。句柄归属、自愈重启与按行解码都在 PiSupervisor 里，
 * 这里只把它的回调翻译成广播。
 */
const pi = new PiSupervisor(
  {
    onLine: line => {
      claimAttachments(line);
      applyPendingSwitch(line);
      broadcast(line);
    },
    onStderr: message => {
      console.error(`[Pi STDERR]: ${message}`);
      broadcast(JSON.stringify({ type: 'pi_stderr', message }));
    },
    onExit: code => {
      console.log(`[Pi Bridge] Pi process exited with code ${code}`);
      broadcast(JSON.stringify({ type: 'pi_process_exit', code }));
    },
    onError: message => {
      console.error('[Pi Bridge] Process error:', message);
      broadcast(JSON.stringify({ type: 'pi_process_error', error: message }));
    },
  },
  currentCwd
);

/**
 * pi 路径的解析结果。
 *
 * 探测与拉起必须用同一个路径。以前这里解析出的绝对路径只给了 supervisor，
 * 探测（probeEnvironment）却仍然用 PATH 里的 `pi`，两套互不相通，于是：
 * 官方安装器把 pi 装到别处 → 装成功 → 日志里也有 Resolved pi at，但向导
 * 永远停在「还没安装 pi」，用户点一次按钮就重装一次。
 */
const piLocator = createPiLocator(defaultRunCommand);

/**
 * 解析 pi 路径并同步给 supervisor，返回解析结果。
 *
 * force 为真时作废缓存重解析：安装完成后必须这样调一次，新装的 pi 可能落在
 * 与上次不同的位置。
 */
async function locatePi(force = false): Promise<string | null> {
  const resolved = force ? await piLocator.refresh() : await piLocator.locate();

  if (resolved && pi.currentCommand !== resolved) {
    pi.setCommand(resolved);
    console.log(`[Pi Bridge] Resolved pi at: ${resolved}`);
  }

  return resolved;
}

/** 安装进行中标记：同一时间只允许一个，否则两个安装器会互相踩 */
let installInFlight = false;

/**
 * 找不到 Git Bash 时，把 pi 的 bash 工具换成 PowerShell。
 *
 * 放在启动时而不是探测接口的副作用里：get_setup_status 是个查询，查询不该改配置。
 *
 * 只动「没配过」或「正好是我们上次写的那一套」的 defaultTools——用户自己配过的
 * 永远不碰（规则表见 toolFallback.ts）。
 */
async function applyToolFallback(): Promise<void> {
  if (process.platform !== 'win32') return;

  const bash = await findGitBash(defaultRunCommand, { shellPath: await readShellPath() });
  const plan = planToolFallback({
    bashAvailable: bash.available,
    defaultTools: await readDefaultTools(),
  });

  if (plan.write) await saveDefaultTools(plan.write);
  console.log(`[Pi Bridge] ${plan.reason}`);
}

/**
 * 工具集回退只做一次。
 * 探测必须等它落定——它会改 settings.json，而 gitBash.mode 正是从那里读出来的。
 * 没等的话，页面会先说「用 bash」，然后再变成「用 PowerShell」。
 */
let toolFallbackReady: Promise<void> = Promise.resolve();

/**
 * 把一次探测结果包成向导需要的全部状态。
 * 供应商目录也一并给前端，免得两边各维护一份、迟早走样。
 */
async function setupPayloadFrom(setup: SetupStatus) {
  return {
    setup,
    installCommand: buildInstallCommand().display,
    preflight: installPreflight(setup),
    providers: PROVIDER_PRESETS,
    subscriptions: SUBSCRIPTION_LOGINS,
    // 用户给供应商起的名字（写在 models.json 里）。界面优先显示它，没有就用内置目录的名字
    providerNames: await readProviderNames(),
  };
}

async function setupPayload() {
  // 先解析一次再探测：探测要用已解析的绝对路径，
  // 否则装到 PATH 之外时会把「装好了」误报成「还没安装 pi」
  await locatePi();
  // 工具集回退会改 settings.json，而 mode 从那里读——必须等它写完
  await toolFallbackReady;
  return setupPayloadFrom(
    await probeEnvironment(defaultRunCommand, { piCommand: pi.currentCommand })
  );
}

/** 环境或凭证变动后广播一次，所有标签页都会跟着更新 */
async function broadcastSetupStatus() {
  broadcast(JSON.stringify({ type: 'setup_status', success: true, ...(await setupPayload()) }));
}

/**
 * 把指令写给 pi。写不进去时必须报错：
 * 静默丢弃会让前端永远等不到回包（例如切会话后对话区一直空着）。
 */
function sendToPi(ws: WebSocket, command: object): boolean {
  if (pi.send(command)) return true;

  const type = (command as { type?: string }).type ?? 'unknown';
  console.warn(`[Pi Bridge] Pi process not ready, dropped command: ${type}`);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'bridge_error', error: 'Pi 进程未就绪，指令没有送达' }));
  }
  return false;
}

wss.on('connection', (ws: WebSocket) => {
  console.log('[Pi Bridge] Client connected via WebSocket');

  // 保证 Pi 运行时已拉起
  pi.ensure(currentCwd);

  // 发送初始桥接状态
  ws.send(JSON.stringify({
    type: 'bridge_status',
    cwd: currentCwd,
    running: pi.running,
  }));

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());

      // 切换工作目录：只接受真实存在的目录，否则 pi 会以无效 cwd 启动失败
      if (data.type === 'change_cwd') {
        const target = path.resolve(String(data.cwd ?? ''));
        fs.stat(target)
          .then(stat => {
            if (!stat.isDirectory()) throw new Error('not a directory');
            currentCwd = target;
            pi.restart(currentCwd);
            broadcast(JSON.stringify({ type: 'cwd_changed', cwd: currentCwd }));
          })
          .catch(err => {
            console.error('[Pi Bridge] Rejected cwd:', target, err?.message ?? err);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'bridge_error',
                error: `无法切换工作目录：${target} 不存在或不是目录`,
              }));
            }
          });
        return;
      }

      // 重启 Pi 进程
      if (data.type === 'restart_pi') {
        pi.restart(currentCwd);
        return;
      }

      // 环境探测：本机够不够跑 pi。向导靠它决定「缺什么、下一步做什么」，
      // 也是「网页能打开但模型不回话」这类困惑的第一道解释。
      if (data.type === 'get_setup_status') {
        // 包一层 setup：顶层已占用 type / success
        reply(ws, 'setup_status', setupPayload, value => value);
        return;
      }

      // 写供应商凭证。
      // 不重启 pi：`/login` 在终端里也是写同一个文件、当前会话立即生效，说明
      // 凭证是惰性读取的，重起反而会把正在聊的会话弄丢。
      if (data.type === 'save_provider_key') {
        const saved = reply(
          ws,
          'provider_saved',
          async () => {
            const provider = String(data.provider ?? '').trim();
            const key = String(data.key ?? '').trim();
            const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl.trim() : '';
            const name = typeof data.name === 'string' ? data.name.trim() : '';

            if (!provider) throw new Error('缺少供应商标识');
            if (!key) throw new Error('API key 不能为空');

            await saveProviderKey(provider, {
              type: 'api_key',
              key,
              ...(baseUrl ? { baseUrl } : {}),
            });

            // 显示名写在 models.json 里（pi 也读它）。空字符串 = 退回官方名字。
            // 只碰 name 这一个键，那份文件里可能躺着用户手写的全套模型细节
            await saveProviderName(provider, name);

            // 回包只带供应商名：key 不回显、也不进日志
            return { provider };
          },
          value => ({ provider: value.provider }),
          () => ({ id: data.id })
        );

        // 必须等配置真的落盘再让 pi 重读：saveProviderKey / saveProviderName 是异步写文件，
        // 抢在它们前面发 get_available_models，pi 读到的还是旧配置——
        // 表现成「配了第二个模型，第一个才出现」这种差一的怪现象。
        void saved.then(() => {
          void broadcastSetupStatus();
          pi.send({ type: 'get_available_models' });
          pi.send({ type: 'get_state' });
        });
        return;
      }

      // 记住默认模型
      if (data.type === 'set_default_model') {
        reply(
          ws,
          'default_model_saved',
          () => saveDefaultModel(String(data.provider ?? ''), String(data.modelId ?? '')),
          () => ({ provider: data.provider, modelId: data.modelId }),
          () => ({ id: data.id })
        );
        return;
      }

      // 已配好凭证的供应商。向导用它做 OAuth 轮询：用户在终端跑完 /login，
      // 这里就能看到变化。
      if (data.type === 'list_configured_providers') {
        reply(ws, 'configured_providers', () => listConfiguredProviders(), providers => ({
          providers,
        }));
        return;
      }

      // 从 <baseUrl>/models 拉模型列表，给自定义端点用。
      // 失败时前端会退化成手填模型 id，所以这里只管把错误说清楚。
      if (data.type === 'list_provider_models') {
        reply(
          ws,
          'provider_models',
          async () => {
            const key = typeof data.key === 'string' ? data.key.trim() : '';
            const models = await fetchProviderModels({
              baseUrl: String(data.baseUrl ?? ''),
              key: key || undefined,
            });
            return { models };
          },
          value => ({ models: value.models }),
          () => ({ id: data.id })
        );
        return;
      }

      // 自定义端点：写 models.json（端点与模型），key 写 auth.json。
      // models.json 每次打开 /model 都会重读，所以不需要重启 pi。
      if (data.type === 'save_custom_provider') {
        const saved = reply(
          ws,
          'custom_provider_saved',
          async () => {
            // 字段叫 providerId 而不是 id：`id` 已经被请求/回包配对占用了，
            // 同名的话前端一旦改用 request 发指令，供应商 id 就会被配对 id 覆盖。
            const id = String(data.providerId ?? '').trim();
            // 这个 id 会变成 auth.json / models.json 里的键，也是 pi 报错时显示的
            // 供应商名，所以限成可读字符，免得出现带空格或中文的键
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
              throw new Error('供应商标识只能包含字母、数字、点、短横线和下划线');
            }

            const baseUrl = normalizeBaseUrl(String(data.baseUrl ?? ''));
            if (!SUPPORTED_APIS.includes(data.api)) throw new Error('不支持的 API 类型');

            const modelIds: string[] = (Array.isArray(data.models) ? data.models : [])
              .map((item: unknown) => String(item).trim())
              .filter(Boolean);
            if (modelIds.length === 0) throw new Error('至少需要填一个模型 id');

            await saveCustomProvider(id, {
              name: String(data.label ?? '').trim() || id,
              baseUrl,
              api: data.api,
              models: modelIds.map(modelId => ({ id: modelId })),
            });

            const key = typeof data.key === 'string' ? data.key.trim() : '';
            if (key) await saveProviderKey(id, { type: 'api_key', key });

            return { id, models: modelIds.length };
          },
          value => ({ provider: value.id, modelCount: value.models }),
          () => ({ id: data.id })
        );

        // 同上：models.json 写完了再让 pi 重读
        void saved.then(() => {
          void broadcastSetupStatus();
          pi.send({ type: 'get_available_models' });
          pi.send({ type: 'get_state' });
        });
        return;
      }

      // 代跑官方安装器。输出逐行广播，整个界面都能看到进度。
      if (data.type === 'install_pi') {
        if (installInFlight) {
          ws.send(JSON.stringify({ type: 'install_refused', error: '已经有一个安装在进行中' }));
          return;
        }

        void (async () => {
          // 重新探一次：用户可能在向导打开期间自己装好了 Node
          const before = await probeEnvironment(defaultRunCommand, {
            piCommand: pi.currentCommand,
          });
          const preflight = installPreflight(before);
          if (!preflight.allowed) {
            ws.send(JSON.stringify({ type: 'install_refused', error: preflight.reason }));
            return;
          }

          installInFlight = true;
          broadcast(JSON.stringify({ type: 'install_started' }));

          try {
            const result = await runInstall({
              onLine: line => broadcast(JSON.stringify({ type: 'install_output', line })),
            });

            // 解析新路径必须在探测之前：装完后当前进程的 PATH 还是旧的
            await locatePi(true);

            // 以「pi 到底能不能跑」为准，而不是安装器的退出码：
            // 它的收尾步骤失败会把「装好了」误报成「装失败了」
            const after = await probeEnvironment(defaultRunCommand, {
              piCommand: pi.currentCommand,
            });
            const outcome = classifyInstallOutcome(result, after.pi.installed);

            broadcast(
              JSON.stringify({
                type: 'install_done',
                ...result,
                ok: outcome.ok,
                error: outcome.error,
                notice: outcome.notice,
              })
            );
            // 复用刚才那次探测，不再重跑一遍
            broadcast(
              JSON.stringify({
                type: 'setup_status',
                success: true,
                ...(await setupPayloadFrom(after)),
              })
            );

            // 用新装的 pi 重新拉起。失败时不动：让用户自己重试，
            // 而不是把一个起不来的进程换成另一个。
            if (outcome.ok) pi.restart(currentCwd);
          } catch (err) {
            console.error('[Pi Bridge] Install failed:', err);
            broadcast(
              JSON.stringify({ type: 'install_done', ok: false, code: null, error: String((err as Error)?.message ?? err) })
            );
          } finally {
            installInFlight = false;
          }
        })();
        return;
      }

      // 历史会话列表：pi 的 RPC 没有列举接口，由桥接扫描会话目录
      if (data.type === 'list_sessions') {
        listSessions()
          .then(({ sessions, total }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'sessions_list', sessions, total }));
            }
          })
          .catch(err => {
            console.error('[Pi Bridge] Failed to list sessions:', err);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({ type: 'sessions_list', sessions: [], total: 0, error: String(err?.message ?? err) })
              );
            }
          });
        return;
      }

      // 切换会话：pi 会把工作目录换成会话里记的 cwd，桥接必须跟着换，
      // 否则设置面板显示的是旧目录，pi 崩溃自愈重启也会在错的目录里拉起
      if (data.type === 'switch_session' && typeof data.sessionPath === 'string') {
        pendingSwitchCwd = readSessionCwdSync(data.sessionPath);
        sendToPi(ws, data);
        return;
      }

      // 历史会话的增删改：pi 的 RPC 只认当前会话，这些都得桥接直接操作文件
      if (data.type === 'rename_session') {
        reply(ws, 'session_renamed', () => renameSession(data.sessionPath, String(data.name ?? '').trim()), () => ({
          sessionPath: data.sessionPath,
        }));
        return;
      }

      // 删除 = 移入回收箱（保留 30 天），所以可以一步到位、不需要二次确认
      if (data.type === 'trash_session') {
        reply(ws, 'session_trashed', () => trashSession(data.sessionPath), () => ({
          sessionPath: data.sessionPath,
        }));
        return;
      }

      if (data.type === 'list_trash') {
        reply(ws, 'trash_list', () => listTrash(), sessions => ({ sessions }));
        return;
      }

      if (data.type === 'restore_session') {
        reply(ws, 'session_restored', () => restoreSession(data.sessionPath), () => ({
          sessionPath: data.sessionPath,
        }));
        return;
      }

      if (data.type === 'purge_session') {
        reply(ws, 'session_purged', () => purgeSession(data.sessionPath), () => ({
          sessionPath: data.sessionPath,
        }));
        return;
      }

      if (data.type === 'empty_trash') {
        reply(ws, 'trash_emptied', () => emptyTrash(), removed => ({ removed }));
        return;
      }

      // 附件上传：浏览器拿不到本地路径，只能把字节传上来落到工作目录，
      // 再把路径交给 pi（agent 自己用工具读）。和 Codex 的 /mention 一个思路。
      if (data.type === 'upload_file') {
        reply(
          ws,
          'file_uploaded',
          () => saveUpload(currentCwd, data.name, data.data),
          result => ({ ...result }),
          // id 必须在失败时也带回去，否则前端配不上号，只能等超时
          () => ({ id: data.id })
        );
        return;
      }

      // 列工作目录（挑文件用）：只看不写，路径必须落在工作目录内
      if (data.type === 'list_dir') {
        reply(
          ws,
          'dir_listing',
          () => listDirectory(currentCwd, data.path),
          listing => ({ ...listing }),
          () => ({ id: data.id })
        );
        return;
      }

      // 弹系统原生的文件选择框。浏览器拿不到本地路径，但桥接就在同一台机器上，
      // 于是「选文件」不需要复制任何字节——文件原地不动，我们只是知道了它在哪。
      if (data.type === 'pick_file') {
        reply(
          ws,
          'files_picked',
          async () => {
            const paths = await pickFiles({ imagesOnly: !!data.imagesOnly });
            picked.remember(paths);
            return { paths };
          },
          value => ({ ...value }),
          () => ({ id: data.id })
        );
        return;
      }

      // 读附件内容：文本→内联，图片→base64，二进制→只报大小
      if (data.type === 'read_attachment') {
        reply(
          ws,
          'attachment_content',
          () => {
            const target = resolveAttachment(currentCwd, data.path, p => picked.allows(p));
            return readAttachment(target);
          },
          value => ({ ...value }),
          () => ({ id: data.id })
        );
        return;
      }

      // 用系统默认程序打开一个附件。路径同样只允许工作目录内的，
      // 或用户刚在文件选择框里选过的。
      if (data.type === 'open_attachment') {
        reply(
          ws,
          'attachment_opened',
          async () => {
            const target = resolveAttachment(currentCwd, data.path, p => picked.allows(p));
            const stat = await fs.stat(target).catch(() => null);
            if (!stat) throw new Error('文件不存在或已经被移动了');
            await openWithSystem(target);
            return {};
          },
          () => ({}),
          () => ({ id: data.id })
        );
        return;
      }

      // 转发指令给 Pi (prompt, abort, new_session, get_state, get_messages 等)
      sendToPi(ws, data);
    } catch (err: any) {
      console.error('[Pi Bridge] Error handling client message:', err);
      ws.send(JSON.stringify({
        type: 'bridge_error',
        error: err.message,
      }));
    }
  });

  ws.on('close', () => {
    console.log('[Pi Bridge] Client disconnected');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Pi Bridge] Server listening on http://${HOST}:${PORT}`);
  console.log(`[Pi Bridge] WebSocket ready on ws://${HOST}:${PORT}`);
  console.log(
    fsSync.existsSync(path.join(DIST_DIR, 'index.html'))
      ? `[Pi Bridge] Serving built frontend from ${DIST_DIR}`
      : '[Pi Bridge] No dist/ yet — run `npm start` to build and serve the UI here'
  );

  // 解析 pi 的绝对路径。不阻塞启动：解析不出来就继续用 PATH 里的 `pi`，
  // 与改造前的行为一致。
  void locatePi().catch(err =>
    console.error('[Pi Bridge] Failed to resolve pi path:', err)
  );

  // 找不到 Git Bash 就把 pi 的 bash 工具换成 PowerShell。
  // 必须赶在第一个 get_setup_status 之前落定（setupPayload 会等它）。
  toolFallbackReady = applyToolFallback().catch(err => {
    console.error('[Pi Bridge] Tool fallback failed:', err);
  });

  // 读一次之前记住的文件名单：历史消息里那些「从电脑选择」的附件重启后才还能打开
  void picked
    .load()
    .then(() => console.log(`[Pi Bridge] Remembered ${picked.size} picked file(s)`))
    .catch(err => console.error('[Pi Bridge] Failed to load picked files:', err));

  // 桥接不常驻，所以靠启动时扫一次来执行回收箱的 30 天保留期
  sweepTrash()
    .then(removed => {
      if (removed > 0) console.log(`[Pi Bridge] Swept ${removed} expired trashed session(s)`);
    })
    .catch(err => console.error('[Pi Bridge] Trash sweep failed:', err));
});
