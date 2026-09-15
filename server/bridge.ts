import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
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
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', name: 'pi-web-bridge' }));
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
