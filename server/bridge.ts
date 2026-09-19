import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import {
  listSessions,
  readSessionCwdSync,
  renameSession,
  deleteSession,
  sessionsRoot,
  SESSION_LIST_LIMIT,
} from './sessions.js';
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
  configPaths,
  deleteProvider,
  readApiKey,
  readAuthProviders,
  readDefaultTools,
  readProviderBaseUrls,
  readProviderNames,
  readShellPath,
  saveDefaultModel,
  saveDefaultTools,
  saveProviderConfig,
} from './setupConfig.js';
import { LaneRegistry, DEFAULT_LANE } from './lanes.js';
import {
  ADVISOR_LANE,
  advisorPersonaPath,
  advisorPiArgs,
  advisorSessionDir,
  ensureAdvisorPersona,
  hasAdvisorSessions,
} from './advisor.js';
import { savePlan } from './planFile.js';
import { historyMessages, type SessionEntry } from './history.js';
import {
  assertModelsUsable,
  allCatalogModels,
  catalogModelsFor,
  derivedEndpointIds,
  isPresetProvider,
  mergeModelDefinitions,
  presetLabel,
  recommendedModelIds,
  sameEndpointUrl,
  upstreamOf,
} from './providerEndpoints.js';
import { createProviderEndpoint } from './setupConfig.js';
import { watchConfigFiles } from './configWatch.js';
import { piNotReadyReply } from './bridgeMessages.js';
import { fetchUpstreamModelIds, probeApi, isHttpUrl } from './apiProbe.js';
import {
  emptyTrash,
  listTrash,
  purgeSession,
  restoreSession,
  sweepTrash,
  trashSession,
} from './trash.js';

/**
 * 桥接端口。默认 3001。
 * 前端认的是 3001，所以这个环境变量只在调试 / 想同时跑第二个实例时用。
 */
const PORT = Number(process.env.PI_BRIDGE_PORT || 3001);
/** 收到这几条就把正在跑的那一轮打断或重启 pi：单独打日志，便于事后定位 */
const WATCHED_COMMANDS = new Set([
  'abort',
  'new_session',
  'switch_session',
  'change_cwd',
  'compact',
  'install_pi',
]);
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

/** 执行窗口（main lane）的工作目录。只有它能改目录，其它 lane 跟着它走 */
let currentCwd = process.cwd();

/** pi 可执行文件。解析出绝对路径后换成它，之后每个 lane 都按这个拉起 */
let piCommand = 'pi';

/** 顾问窗口选的模型（只存内存、只作用于顾问进程，绝不写全局默认模型） */
const laneModels = new Map<string, string>();

/** 用户亲手选过的文件路径（工作目录之外的只允许读/打开这些） */
const picked = new PickedFiles(pickedFilesStorePath());

/**
 * 顾问的会话目录与人格文件。都在 `~/.pi/agent/` 下，与 pi-web 自己的持久化文件放在一起。
 * 会话目录必须独立：两个 pi 进程 append 同一份转录会毁掉历史。
 */
const ADVISOR_SESSION_DIR = advisorSessionDir();
const ADVISOR_PERSONA_FILE = advisorPersonaPath();

/**
 * 每个连接属于哪个 lane。
 * 没登记过的一律算 `main`：不带 lane 的旧页面、再开的标签页仍然镜像同一个会话，
 * 这是改造前就有的语义，不能破。
 */
const connLanes = new WeakMap<WebSocket, string>();

/** 等回包的 pi 请求（见 requestFromPi） */
const pendingPiRequests = new Map<
  string,
  { settle: (value: unknown) => void; swallow: boolean }
>();

function laneOf(ws: WebSocket): string {
  return connLanes.get(ws) ?? DEFAULT_LANE;
}

/** 全局事实（环境探测、安装输出、配置变更）发给所有客户端 */
function broadcast(msg: string) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

/**
 * 某个 lane 的对话输出只发给这个 lane 的客户端。
 *
 * 这是 lane 化的硬要求：lane A 的 `get_messages` / `get_state` / `get_available_models`
 * 回包如果广播出去，lane B 的处理器会当成自己的状态更新，界面就会用错的历史与模型。
 */
function sendToLane(lane: string, msg: string) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && laneOf(client) === lane) {
      client.send(msg);
    }
  });
}

/** 这个 lane 的工作目录。只有 main 能改，所以其它 lane 跟着 main 走 */
function cwdForLane(lane: string): string {
  return lanes.get(lane)?.cwd ?? currentCwd;
}

/**
 * pi 的某条输出是不是我们要等的回包。
 *
 * 返回 true = 这条回包是桥接自己要的，不要再转给前端。拿目录清单那种顺带
 * 刷一下前端也无所谓，但 `get_entries` 是整段会话（几 MB），转过去纯属浪费。
 */
function settlePiRequest(line: string): boolean {
  if (!line.includes('"id":"bridge-req-')) return false;
  try {
    const message = JSON.parse(line);
    const waiter = typeof message?.id === 'string' ? pendingPiRequests.get(message.id) : undefined;
    if (!waiter) return false;
    pendingPiRequests.delete(message.id);
    waiter.settle(message);
    return waiter.swallow;
  } catch {
    return false;
  }
}

/**
 * 向 pi 发一条指令并等它的回包（按 id 配对）。
 *
 * `swallow` 为真时这条回包不转给前端（几 MB 的 `get_entries` 没必要转）。
 * `lane` 决定问哪个 pi 进程：顾问窗口的历史得问顾问那条。
 */
function requestFromPi<T = any>(
  command: object,
  options: { timeoutMs?: number; lane?: string; swallow?: boolean } = {}
): Promise<T> {
  const { timeoutMs = 20_000, lane = DEFAULT_LANE, swallow = false } = options;
  const id = `bridge-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingPiRequests.delete(id);
      reject(new Error('pi 没有响应（超时）'));
    }, timeoutMs);

    pendingPiRequests.set(id, {
      settle: value => {
        clearTimeout(timer);
        resolve(value as T);
      },
      swallow,
    });

    if (!lanes.send(lane, { ...command, id })) {
      clearTimeout(timer);
      pendingPiRequests.delete(id);
      reject(new Error('pi 还没就绪，稍后再试'));
    }
  });
}

/**
 * pi 内置目录的原始模型清单。
 *
 * 拿不到就当空（pi 没装 / 没起来 / 超时）：探测与保存都不该因为这一项整个失败，
 * 顶多退回「只用上游报的 id」那种最小定义。
 */
async function catalogModels(): Promise<unknown[]> {
  try {
    lanes.ensure(DEFAULT_LANE, currentCwd);
    const response = await requestFromPi<{ data?: { models?: unknown[] } }>(
      { type: 'get_available_models' },
      { timeoutMs: 8_000 }
    );
    return response?.data?.models ?? [];
  } catch {
    return [];
  }
}

/**
 * pi 内置目录里某个上游的模型定义（已剥掉 baseUrl，可以直接写进 models.json）。
 */
async function catalogFor(upstream: string): Promise<Record<string, unknown>[]> {
  return catalogModelsFor(await catalogModels(), upstream);
}

/**
 * 这个上游名下、地址正好是 `baseUrl` 的已配端点 id。
 *
 * 供应商下拉里只有内置目录的那些，不再列端点，所以「重新配一遍中转」就是
 * 选中上游 + 重填同一个地址。没有这层匹配的话，每保存一次就会多出一个
 * `deepseek-relay-2`、`-3`，而用户只想改地址。
 */
async function endpointForAddress(
  upstream: string,
  baseUrl: string
): Promise<string | null> {
  try {
    const baseUrls = await readProviderBaseUrls();
    return (
      derivedEndpointIds(upstream, Object.keys(baseUrls)).find(id =>
        sameEndpointUrl(baseUrls[id], baseUrl)
      ) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * 顾问进程的附加参数。
 *
 * 人格文件必须**先落盘**：pi 的 `--system-prompt` 只把「存在的路径」当文件读，
 * 少了这个文件它会把路径本身当成系统提示词。
 */
function advisorArgs(): string[] {
  ensureAdvisorPersona(ADVISOR_PERSONA_FILE);
  return advisorPiArgs({
    personaPath: ADVISOR_PERSONA_FILE,
    sessionDir: ADVISOR_SESSION_DIR,
    resume: hasAdvisorSessions(ADVISOR_SESSION_DIR),
    model: laneModels.get(ADVISOR_LANE),
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
 * 会话路径的归属：顾问目录下的归顾问，其余是项目会话。
 *
 * 侧栏长在执行窗口那条连接上，但它也要能列 / 开 / 改 / 删顾问的会话——
 * 所以这些操作不能按「哪条连接发来的」路由，得按「文件在哪个目录」。
 * 这也顺带保证了：项目侧的操作永远碰不到顾问目录里的文件（路径守卫会拒）。
 */
function isAdvisorSessionPath(sessionPath: string): boolean {
  const advisorRoot = path.resolve(ADVISOR_SESSION_DIR) + path.sep;
  return path.resolve(sessionPath).startsWith(advisorRoot);
}

/** 列某个范围的会话。advisor = 顾问自己的目录（平铺，不是默认的项目布局） */
function sessionRootForScope(scope: unknown): string {
  return scope === ADVISOR_LANE ? ADVISOR_SESSION_DIR : sessionsRoot();
}

/**
 * pi 确认会话切换成功后，把这个 lane 的工作目录一并换掉。
 * 失败或被扩展取消时 pi 的工作目录没变，必须保持原样。
 */
function applyPendingSwitch(laneId: string, line: string) {
  const lane = lanes.get(laneId);
  if (!lane || !lane.pendingSwitchCwd || !line.includes('switch_session')) return;

  let message: any;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message?.type !== 'response' || message.command !== 'switch_session') return;

  if (!message.success || message.data?.cancelled) {
    lane.pendingSwitchCwd = null;
    return;
  }

  const next = lane.pendingSwitchCwd;
  lane.pendingSwitchCwd = null;
  if (!next) return;

  lane.cwd = next;
  // 只有执行窗口的目录会牵动整个桥接（上传、列目录都用它）
  if (laneId === DEFAULT_LANE) currentCwd = next;
  console.log(`[Pi Bridge] Session switch moved cwd to: ${next} (lane: ${laneId})`);
  sendToLane(laneId, JSON.stringify({ type: 'cwd_changed', cwd: next, lane: laneId }));
}

/**
 * pi 子进程的持有者。句柄归属、自愈重启与按行解码都在 PiSupervisor 里，
 * 这里只把它的回调翻译成「只发给这个 lane」。
 *
 * 进程按 lane 惰性创建：没开助手模式的人不会平白多一个 pi 进程。
 */
const lanes = new LaneRegistry(
  {
    onLine: (lane, line) => {
      // 桥接自己要的回包（如整段会话条目）不再转给前端
      if (settlePiRequest(line)) return;
      claimAttachments(line);
      applyPendingSwitch(lane, line);
      settlePiRequest(line);
      sendToLane(lane, line);
    },
    onStderr: (lane, message) => {
      console.error(`[Pi STDERR][${lane}]: ${message}`);
      sendToLane(lane, JSON.stringify({ type: 'pi_stderr', message, lane }));
    },
    onExit: (lane, code) => {
      console.log(`[Pi Bridge] Pi process exited with code ${code} (lane: ${lane})`);
      sendToLane(lane, JSON.stringify({ type: 'pi_process_exit', code, lane }));
    },
    onError: (lane, message) => {
      console.error(`[Pi Bridge] Process error [${lane}]:`, message);
      sendToLane(lane, JSON.stringify({ type: 'pi_process_error', error: message, lane }));
    },
  },
  {
    initialCwd: currentCwd,
    command: piCommand,
    // 白名单：不在里面的 laneId 一律落到 main（旧页面兼容）
    allowed: [DEFAULT_LANE, ADVISOR_LANE],
    specs: {
      // 顾问：没有工具、独立会话目录、独立人格，而且不参与切工作目录
      [ADVISOR_LANE]: { extraArgs: advisorArgs(), allowCwdChange: false },
    },
  }
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

  if (resolved && piCommand !== resolved) {
    piCommand = resolved;
    lanes.setCommand(resolved);
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
    // 已配的中转地址。表单回显用，不然只换 key 会把地址覆盖掉
    providerBaseUrls: await readProviderBaseUrls(),
    // 哪些供应商能删：auth.json 里的那些（只设了环境变量的删不掉）
    deletableProviders: await readAuthProviders(),
  };
}

async function setupPayload() {
  // 先解析一次再探测：探测要用已解析的绝对路径，
  // 否则装到 PATH 之外时会把「装好了」误报成「还没安装 pi」
  await locatePi();
  // 工具集回退会改 settings.json，而 mode 从那里读——必须等它写完
  await toolFallbackReady;
  return setupPayloadFrom(
    await probeEnvironment(defaultRunCommand, { piCommand })
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
function sendToPi(ws: WebSocket, lane: string, command: object): boolean {
  if (lanes.send(lane, command)) return true;

  const type = (command as { type?: string }).type ?? 'unknown';
  console.warn(`[Pi Bridge] Pi process not ready, dropped command: ${type} (lane: ${lane})`);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(piNotReadyReply(command));
  }
  return false;
}

/**
 * 回一份**整段会话**的历史。
 *
 * 不能用 pi 的 `get_messages`：它给的是模型当前上下文，自动压缩之后被压掉的
 * 那一段就整个消失了——界面上只剩摘要之后的三两条，右侧轨道也跟着只剩一根
 * 线。会话文件是只增不减的，所以改走 `get_entries`（当前分支的全部条目），
 * 压缩摘要按它保留的第一条之前插回去。
 *
 * 拿不到就退回 pi 的上下文：宁可少显示，也不能让对话区一直空着。
 */
async function sendFullHistory(ws: WebSocket, lane: string) {
  const internal = { lane, swallow: true, timeoutMs: 30_000 };

  try {
    const [tree, context] = await Promise.all([
      requestFromPi<{ data?: { entries?: SessionEntry[]; leafId?: string } }>(
        { type: 'get_entries' },
        internal
      ),
      requestFromPi<{ data?: { messages?: unknown[] } }>({ type: 'get_messages' }, internal),
    ]);

    const line = JSON.stringify({
      type: 'response',
      command: 'get_messages',
      success: true,
      data: {
        messages: historyMessages(
          tree?.data?.entries ?? [],
          tree?.data?.leafId,
          context?.data?.messages as any[]
        ),
      },
    });

    // 附件白名单也认一遍：压缩掉的那段里贴过的附件现在也回到界面上了
    claimAttachments(line);
    if (ws.readyState === WebSocket.OPEN) ws.send(line);
  } catch (err) {
    console.warn('[Pi Bridge] 取全量历史失败，退回 pi 的上下文:', (err as Error).message);
    sendToPi(ws, lane, { type: 'get_messages' });
  }
}

wss.on('connection', (ws: WebSocket) => {
  console.log('[Pi Bridge] Client connected via WebSocket');

  // 保证执行窗口的 Pi 运行时已拉起（打开页面就会起，与改造前一致）
  lanes.ensure(DEFAULT_LANE, currentCwd);

  // 发送初始桥接状态
  ws.send(JSON.stringify({
    type: 'bridge_status',
    cwd: currentCwd,
    running: lanes.running(DEFAULT_LANE),
  }));

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());

      // lane 是**连接属性**：登记一次，这条连接的所有输出都按它路由。
      // 客户端每条指令都带 lane，所以即使 register_lane 丢了（旧版桥接转发了它）
      // 也能按第一条带 lane 的指令自愈。
      if (data.type === 'register_lane') {
        const target = lanes.normalize(data.lane);
        connLanes.set(ws, target);
        lanes.ensure(target, target === DEFAULT_LANE ? currentCwd : cwdForLane(DEFAULT_LANE));
        console.log(`[Pi Bridge] 客户端登记 lane: ${target}`);
        void reply(
          ws,
          'lane_registered',
          async () => ({ lane: target, cwd: cwdForLane(target), running: lanes.running(target) }),
          value => ({ ...value }),
          () => ({ id: data.id })
        );
        return;
      }

      if (!connLanes.has(ws) && typeof data.lane === 'string') {
        connLanes.set(ws, lanes.normalize(data.lane));
      }
      const lane = laneOf(ws);

      // 这几条会把正在跑的那一轮打断（abort / 新建 / 切会话）或重启 pi
      // （change_cwd / 装 pi）。打一行日志，下次「对话自己暂停了」时有据可查。
      // lane 必须带上：两个窗口都在跑，只写指令名分不清是哪一个被断了。
      if (WATCHED_COMMANDS.has(data.type)) {
        console.log(`[Pi Bridge] 收到指令 ${data.type} (lane: ${lane})`);
      }

      // 切换工作目录：只接受真实存在的目录，否则 pi 会以无效 cwd 启动失败
      if (data.type === 'change_cwd') {
        // 顾问窗口不参与切目录：它没有工具，切了也没意义，
        // 而且会把执行窗口的目录一起带跑
        if (lanes.lane(lane).spec.allowCwdChange === false) {
          ws.send(JSON.stringify({ type: 'bridge_error', error: '这个窗口不能切换工作目录' }));
          return;
        }

        const target = path.resolve(String(data.cwd ?? ''));
        fs.stat(target)
          .then(stat => {
            if (!stat.isDirectory()) throw new Error('not a directory');
            currentCwd = target;
            lanes.restart(DEFAULT_LANE, currentCwd);
            sendToLane(DEFAULT_LANE, JSON.stringify({ type: 'cwd_changed', cwd: currentCwd }));
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

      // 上游 API 探针：带上该供应商的密钥去请求上游的模型列表，一次验地址 / 密钥 /
      // 模型是否存在（GET /models，不产生 token 花费）。浏览器直连会被 CORS 挡住，
      // 而且密钥在服务端，所以必须由桥接发。
      if (data.type === 'probe_api') {
        reply(
          ws,
          'api_probed',
          async () => {
            const provider = String(data.provider ?? '').trim();
            const modelId = String(data.modelId ?? '').trim();
            const baseUrl = String(data.baseUrl ?? '').trim();
            const api = String(data.api ?? '').trim();

            if (!isHttpUrl(baseUrl)) throw new Error('上游地址不是 http/https');

            const key = provider ? await readApiKey(provider) : null;
            return { result: await probeApi({ modelId, baseUrl, api, key }) };
          },
          value => ({ result: value.result }),
          () => ({ id: data.id })
        );
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
      // 中转端点：先探一次上游到底有哪些模型，让用户勾选要加哪些。
      //
      // 不能照单全收：真实案例里一个「DeepSeek」分组同时卖 glm-5.3 / kimi-k3 /
      // qwen3.8-max，全加进去会让名叫「DeepSeek 中转」的端点下挂着一堆别的厂商的模型，
      // 用户一看就懵（「我选的 deepseek，怎么冒出十几个」）。
      if (data.type === 'probe_endpoint_models') {
        const probed = reply(
          ws,
          'endpoint_models_probed',
          async () => {
            const provider = String(data.provider ?? '').trim();
            const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl.trim() : '';
            if (!baseUrl) throw new Error('请先填中转地址');
            if (!isHttpUrl(baseUrl)) throw new Error('中转地址必须是 http(s) 链接');

            const presetIds = PROVIDER_PRESETS.map(preset => preset.id);
            const upstream = upstreamOf(provider, presetIds);

            // 密钥可以不重贴：编辑已有端点时用端点自己存着的那份。
            // （重配中转 = 选中上游 + 重填同一个地址，见 endpointForAddress）
            const reuse = upstream ? await endpointForAddress(upstream, baseUrl) : null;
            const key =
              (typeof data.key === 'string' ? data.key.trim() : '') ||
              (reuse ? (await readApiKey(reuse)) || '' : '') ||
              (await readApiKey(provider)) ||
              '';

            // 认不出上游（用户手写的端点 id，如 `wode`）：照样把上游报的清单列出来
            // 让用户自己勾，只是不预勾任何东西——总比直接报错、什么都不给强
            const catalog = upstream ? await catalogFor(upstream) : [];
            const catalogIds = catalog.map(model => String(model.id));
            const upstreamIds = await fetchUpstreamModelIds(baseUrl, key);

            // 上游拿不到（地址写错、分组不暴露清单）就退回内置目录，照样能让用户勾
            const ids = upstreamIds ?? catalogIds;
            const recommended = new Set(
              !upstream
                ? []
                : upstreamIds
                  ? recommendedModelIds(upstream, ids, catalogIds)
                  : catalogIds
            );

            return {
              provider,
              upstream: upstream ?? '',
              from: upstreamIds ? 'upstream' : 'catalog',
              models: ids.map(id => ({ id, recommended: recommended.has(id) })),
            };
          },
          value => ({ ...value }),
          () => ({ id: data.id })
        );

        void probed;
        return;
      }

      if (data.type === 'save_provider_key') {
        const saved = reply(
          ws,
          'provider_saved',
          async () => {
            const provider = String(data.provider ?? '').trim();
            const key = typeof data.key === 'string' ? data.key.trim() : '';
            const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl.trim() : '';
            const name = typeof data.name === 'string' ? data.name.trim() : '';
            // 填了中转地址 = 要一个**独立端点**：新的供应商 id + 自己的密钥地址 +
            // 从 pi 内置目录复制的模型清单。官方条目不动（残留的旧地址会被迁走）。
            // 不这么做的话，中转地址会写进官方那一条，把官方入口覆盖掉——
            // 用户配完中转就发现「官方的没了」，而界面上看起来还是官方那个。
            if (baseUrl && data.newEndpoint === true) {
              const presetIds = PROVIDER_PRESETS.map(preset => preset.id);
              // 认不出上游也能存：只是没有内置目录可兜底、也没官方条目要迁
              const upstream = upstreamOf(provider, presetIds) ?? provider;
              // 要改的是哪一个端点：
              //  - 前端直接给了端点 id（旧版下拉 / 直接调接口）就是它自己
              //  - 否则看这个上游名下有没有指向同一地址的端点（下拉里只有官方入口之后，
              //    「重配中转」就是这个形状）。不认的话每保存一次就多一个 -2、-3
              const existingEndpoint = isPresetProvider(provider)
                ? await endpointForAddress(upstream, baseUrl)
                : provider;
              // 改已有端点时密钥可以不重贴：用存着的那份
              const endpointKey =
                key || (existingEndpoint ? (await readApiKey(existingEndpoint)) || '' : '');

              const rawCatalog = await catalogModels();
              const catalog = catalogModelsFor(rawCatalog, upstream);
              const catalogIds = catalog.map(model => String(model.id));

              // 前端勾好的清单优先：探测那一步已经把「上游有哪些」给用户看过一遍了
              const picked = Array.isArray(data.models)
                ? data.models.filter((id: unknown): id is string => typeof id === 'string')
                : [];

              let ids: string[];
              if (picked.length > 0) {
                ids = picked;
              } else {
                // 没带勾选结果（旧前端 / 直接调接口）：自己探一次，只取该上游自己的那些
                const upstreamIds = await fetchUpstreamModelIds(baseUrl, endpointKey);
                ids = upstreamIds
                  ? recommendedModelIds(upstream, upstreamIds, catalogIds)
                  : catalogIds;
              }

              // 兜底定义去整份目录里找：中转分组常挂着别家的模型（glm / kimi），
              // 只在上游自己名下找的话它们连 reasoning 都没有，思考档位只剩 off
              const models = mergeModelDefinitions(ids, catalog, allCatalogModels(rawCatalog));
              assertModelsUsable(models);

              const created = await createProviderEndpoint({
                provider: upstream,
                id: existingEndpoint ?? undefined,
                name: name || `${presetLabel(upstream) ?? upstream} 中转`,
                baseUrl,
                key: endpointKey,
                models,
              });

              // 新供应商必须重启 pi 才会被看见：pi 只在启动时读 models.json，
              // RPC 里没有热重载。保存端点是低频、刻意的动作，重启的代价可以接受
              // （与 install_pi 之后 restartAll 同一个先例）。
              lanes.restartAll(currentCwd);

              // 回包用新 id：前端好知道该选哪一个
              return {
                provider: created.id,
                endpointOf: upstream,
                migrated: created.migrated,
                restarted: true,
                modelCount: models.length,
              };
            }

            // key 留空是允许的（只改名字/地址）：saveProviderConfig 会判断这个
            // 供应商是不是已经配过，没配过才报「API key 不能为空」。
            await saveProviderConfig({ provider, key, baseUrl, name });

            // 回包只带供应商名：key 不回显、也不进日志
            return { provider };
          },
          value => ({ ...value }),
          () => ({ id: data.id })
        );

        // 必须等配置真的落盘再让 pi 重读：saveProviderConfig 是异步写文件，
        // 抢在它们前面发 get_available_models，pi 读到的还是旧配置——
        // 表现成「配了第二个模型，第一个才出现」这种差一的怪现象。
        void saved.then(() => {
          void broadcastSetupStatus();
          lanes.sendToAll({ type: 'get_available_models' });
          lanes.sendToAll({ type: 'get_state' });
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

      // 删除一个供应商的凭证。
      if (data.type === 'delete_provider') {
        const saved = reply(
          ws,
          'provider_deleted',
          async () => {
            const provider = String(data.provider ?? '').trim();
            if (!provider) throw new Error('缺少供应商标识');
            await deleteProvider(provider);
            return { provider };
          },
          value => ({ provider: value.provider }),
          () => ({ id: data.id })
        );

        // 和保存一样：落盘后再让 pi 重读
        void saved.then(() => {
          void broadcastSetupStatus();
          lanes.sendToAll({ type: 'get_available_models' });
          lanes.sendToAll({ type: 'get_state' });
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
            piCommand,
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
              piCommand,
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

            // 用新装的 pi 重新拉起每个 lane。失败时不动：让用户自己重试，
            // 而不是把一个起不来的进程换成另一个。
            if (outcome.ok) lanes.restartAll(currentCwd);
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

      // 历史会话列表：pi 的 RPC 没有列举接口，由桥接扫描会话目录。
      // scope=advisor 时列的是顾问自己的目录（侧栏的顾问分组用），
      // 回包带同一个 scope，前端才知道该填哪个列表。
      if (data.type === 'list_sessions') {
        const scope = data.scope === ADVISOR_LANE ? ADVISOR_LANE : undefined;
        listSessions(SESSION_LIST_LIMIT, sessionRootForScope(scope))
          .then(({ sessions, total }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'sessions_list', scope, sessions, total }));
            }
          })
          .catch(err => {
            console.error('[Pi Bridge] Failed to list sessions:', err);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({ type: 'sessions_list', scope, sessions: [], total: 0, error: String(err?.message ?? err) })
              );
            }
          });
        return;
      }

      // 切换会话：pi 会把工作目录换成会话里记的 cwd，桥接必须跟着换，
      // 否则设置面板显示的是旧目录，pi 崩溃自愈重启也会在错的目录里拉起。
      // 顾问目录下的会话归顾问那条 lane：侧栏长在执行窗口的连接上，但点顾问的
      // 历史要切的是顾问那边的 pi，回包也只回顾问那边（发送方本地不进「切换中」）。
      if (data.type === 'switch_session' && typeof data.sessionPath === 'string') {
        const advisorSession = isAdvisorSessionPath(data.sessionPath);
        const target = advisorSession ? ADVISOR_LANE : lane;
        // 替另一条 lane 切会话时，得让那条 lane 也进「切换中」，
        // 否则它不会把新历史换上去，界面会停在旧会话上
        if (target !== lane) {
          sendToLane(target, JSON.stringify({ type: 'session_switching', lane: target }));
        }
        lanes.lane(target).pendingSwitchCwd = readSessionCwdSync(
          data.sessionPath,
          advisorSession ? ADVISOR_SESSION_DIR : sessionsRoot()
        );
        sendToPi(ws, target, data);
        return;
      }

      // 历史会话的增删改：pi 的 RPC 只认当前会话，这些都得桥接直接操作文件。
      // 根目录按文件在哪来：顾问目录下的归顾问（项目侧的操作碰不到它）。
      if (data.type === 'rename_session') {
        const root = isAdvisorSessionPath(data.sessionPath) ? ADVISOR_SESSION_DIR : sessionsRoot();
        reply(
          ws,
          'session_renamed',
          () => renameSession(data.sessionPath, String(data.name ?? '').trim(), root),
          () => ({ sessionPath: data.sessionPath, scope: isAdvisorSessionPath(data.sessionPath) ? ADVISOR_LANE : undefined })
        );
        return;
      }

      // 删除：项目会话进回收箱（保留 30 天）；顾问会话直接删——
      // 它的沉淀物在 docs/plans/ 里，会话文件本身没什么可后悔的
      if (data.type === 'trash_session') {
        if (isAdvisorSessionPath(data.sessionPath)) {
          reply(
            ws,
            'session_trashed',
            () => deleteSession(data.sessionPath, ADVISOR_SESSION_DIR),
            () => ({ sessionPath: data.sessionPath, scope: ADVISOR_LANE })
          );
          return;
        }
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

      // 顾问窗口换模型。
      //
      // **不能**走 set_model / set_default_model：那条路会把默认模型写进
      // settings.json，执行窗口的默认模型也跟着变了。这里只在内存里记着，
      // 重启顾问进程时用 `--model` 传进去，全局配置一个字节都不动。
      if (data.type === 'set_lane_model') {
        if (lane === DEFAULT_LANE) {
          ws.send(
            JSON.stringify({ type: 'bridge_error', error: '执行窗口换模型请走 set_model' })
          );
          return;
        }

        const model = String(data.model ?? '').trim();
        if (model) laneModels.set(lane, model);
        else laneModels.delete(lane);

        const target = lanes.lane(lane);
        target.setExtraArgs(advisorArgs());
        target.restart(cwdForLane(DEFAULT_LANE));
        // 让前端拿到「实际生效」的模型，而不是它自己以为的那个
        lanes.send(lane, { type: 'get_state' });

        void reply(
          ws,
          'lane_model_set',
          async () => ({ lane, model }),
          value => ({ ...value }),
          () => ({ id: data.id })
        );
        return;
      }

      // 把顾问的结论落成计划文件。
      // 落文件而不是直接贴给执行窗口：执行方用工具读全文，推理链不丢，
      // 而且这份计划能回看、能改、能多轮迭代（与仓库里 AGENTS.md 的 plan 约定一致）。
      if (data.type === 'save_plan_file') {
        reply(
          ws,
          'plan_file_saved',
          async () => savePlan(currentCwd, { text: String(data.text ?? '') }),
          value => ({ relative: value.relative, absolute: value.absolute }),
          () => ({ id: data.id })
        );
        return;
      }

      // 历史要给整段会话（见 sendFullHistory），不能再转发 pi 的 get_messages：
      // 那个只有压缩之后的上下文，用户会以为上面的对话丢了
      if (data.type === 'get_messages') {
        void sendFullHistory(ws, lane);
        return;
      }

      // 转发指令给 Pi (prompt, abort, new_session, get_state 等)
      sendToPi(ws, lane, data);
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

  // 盯着 auth.json / models.json：用户在终端里跑完 /login、或手改 models.json
  // 加了个模型之后，已打开的页面不该等到重连才发现新模型。
  // 只读两个文件的 mtime，代价可忽略。
  const { auth, models } = configPaths();
  watchConfigFiles({
    files: [auth, models],
    onChange: () => {
      console.log('[Pi Bridge] Config files changed, refreshing models');
      void broadcastSetupStatus();
      // 配置是全局的：每个已经起来的 lane 都重读一次
      lanes.sendToAll({ type: 'get_available_models' });
      lanes.sendToAll({ type: 'get_state' });
    },
  });
});
