import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  PiMessage,
  BridgeStatus,
  MessageAttachment,
  DirListing,
  AttachmentContent,
} from '../types/pi';
import { RpcEventHandler } from '../services/rpcHandler';
import {
  IMAGE_ONLY_INSTRUCTION,
  buildPromptWithAttachments,
  readFileAsBase64,
  type PromptDraft,
  type UploadedFile,
} from '../utils/attachments';

interface PendingRequest {
  expectedType: string;
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: number;
}

/** 桥接请求（上传 / 列目录）的超时；超过了就当作失败，不让界面一直等 */
const REQUEST_TIMEOUT_MS = 60_000;

export function usePiWebSocket() {
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [status, setStatus] = useState<BridgeStatus>({
    connected: false,
    cwd: '',
    isStreaming: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const isMountedRef = useRef(true);
  /**
   * 等待回包的桥接请求。
   * rpcHandler 处理的是「pi 推来的事件」，而上传 / 列目录是「桥接对我这次请求的回答」，
   * 需要按 id 配对，所以单独一套。
   */
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());

  // 专属解耦的 RPC 事件处理器：惰性初始化一次即可。用 useState 而不是渲染期间写 ref，
  // setMessages/setStatus 来自 useState，引用是稳定的，所以处理器只需构造一次。
  const [handler] = useState(() => new RpcEventHandler(setMessages, setStatus));

  const requestInitialState = (ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'get_state' }));
      ws.send(JSON.stringify({ type: 'get_messages' }));
      ws.send(JSON.stringify({ type: 'get_available_models' }));
      ws.send(JSON.stringify({ type: 'get_available_thinking_levels' }));
      ws.send(JSON.stringify({ type: 'get_session_stats' }));
      // 连接建立后再拉历史会话，否则首屏调用时连接尚未就绪
      ws.send(JSON.stringify({ type: 'list_sessions' }));
    }
  };

  /** 按 id 把回包交给等待中的 Promise；配不上号就返回 false，交给 rpcHandler */
  const settleRequest = useCallback((data: any): boolean => {
    const pending =
      typeof data?.id === 'string' ? pendingRequestsRef.current.get(data.id) : undefined;
    if (!pending || pending.expectedType !== data.type) return false;

    pendingRequestsRef.current.delete(data.id);
    window.clearTimeout(pending.timer);

    if (data.success) pending.resolve(data);
    else pending.reject(new Error(data.error ?? '桥接操作失败'));
    return true;
  }, []);

  /** 发一条桥接指令并等它的回包 */
  const request = useCallback(
    <T,>(type: string, responseType: string, payload: Record<string, unknown> = {}): Promise<T> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('未连接到桥接服务'));
      }

      return new Promise<T>((resolve, reject) => {
        const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timer = window.setTimeout(() => {
          pendingRequestsRef.current.delete(id);
          reject(new Error('请求超时'));
        }, REQUEST_TIMEOUT_MS);

        pendingRequestsRef.current.set(id, { expectedType: responseType, resolve, reject, timer });
        ws.send(JSON.stringify({ type, id, ...payload }));
      });
    },
    []
  );

  /**
   * 把文件交给桥接落到工作目录，拿回相对路径。
   * 浏览器出于安全不会告诉页面文件的本地路径，所以字节只能传上去。
   */
  const uploadFile = useCallback(
    async (file: File): Promise<UploadedFile> => {
      const data = await readFileAsBase64(file);
      return request<UploadedFile>('upload_file', 'file_uploaded', {
        name: file.name,
        data,
      });
    },
    [request]
  );

  /** 列工作目录。给「从工作目录选文件」用——只读路径，不传字节。 */
  const listDir = useCallback(
    (relativePath = ''): Promise<DirListing> =>
      request<DirListing>('list_dir', 'dir_listing', { path: relativePath }),
    [request]
  );

  /**
   * 读一个附件：文本拿内容、图片拿 base64、二进制只要大小。
   */
  const readAttachment = useCallback(
    (filePath: string): Promise<AttachmentContent> =>
      request<AttachmentContent>('read_attachment', 'attachment_content', { path: filePath }),
    [request]
  );

  /**
   * 弹系统原生的文件选择框，拿回**绝对路径**。
   *
   * 关键：浏览器出于安全拿不到本地路径，但桥接就跑在同一台机器上，可以替用户
   * 弹一个原生对话框。于是「选文件」不需要复制任何字节——文件原地不动，
   * 我们只是知道了它在哪。用户取消时返回空数组。
   */
  const pickFile = useCallback(
    async (imagesOnly = false): Promise<string[]> => {
      const result = await request<{ paths?: string[] }>('pick_file', 'files_picked', {
        imagesOnly,
      });
      return result.paths ?? [];
    },
    [request]
  );

  // 命名函数表达式：让递归重连引用自身，而不是在初始化过程中引用 connectWs
  const connectWs = useCallback(function connect() {
    if (!isMountedRef.current) return;

    // 已存在活着的连接（连接中或已打开）则直接复用，避免连接风暴
    const existing = wsRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN ||
        existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:3001`
    );
    wsRef.current = ws;

    // 陈旧 socket 的事件一律忽略（StrictMode 双挂载 / 重连替换时至关重要）
    const isStale = () => wsRef.current !== ws;

    ws.onopen = () => {
      if (!isMountedRef.current || isStale()) return;
      setStatus(prev => ({ ...prev, connected: true }));
      requestInitialState(ws);
    };

    ws.onclose = () => {
      if (isStale()) return; // 已被新连接取代，不触发重连
      if (!isMountedRef.current) return;

      setStatus(prev => ({ ...prev, connected: false, isStreaming: false }));
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) connect();
      }, 2000);
    };

    ws.onerror = () => {
      // 由 onclose 统一处理重连
    };

    ws.onmessage = (event) => {
      if (isStale()) return;
      try {
        const data = JSON.parse(event.data);
        if (settleRequest(data)) return;
        handler.handleEvent(data, ws);
      } catch (e) {
        console.error('[usePiWebSocket] Failed to process message', e);
      }
    };
  }, [handler, settleRequest]);

  useEffect(() => {
    isMountedRef.current = true;
    connectWs();

    // 捕获这个 Map 本身（引用终身不变），cleanup 里就不必再读 ref.current
    const pendingRequests = pendingRequestsRef.current;

    return () => {
      isMountedRef.current = false;
      clearTimeout(reconnectTimeoutRef.current);
      // 断线时把还在等的请求一并拒掉，否则那些 Promise 会悬在那里
      pendingRequests.forEach(pending => {
        window.clearTimeout(pending.timer);
        pending.reject(new Error('连接已关闭'));
      });
      pendingRequests.clear();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWs]);

  /**
   * 发一轮对话。
   *
   * 图片走 pi 原生的 `prompt.images`（模型真的「看见」它），
   * 文件没有原生通道，只能把路径写进正文让 agent 自己去读——两条路必须在
   * 这里分开，否则图片也会退化成一行路径。
   *
   * 界面上的 user 消息只存干净的正文 + 结构化 attachments，不存那行路径，
   * 这样气泡里能渲染成图片 / 文件卡片而不是一堆文字。
   */
  const sendPrompt = useCallback((draft: PromptDraft) => {
    const text = draft.text.trim();
    const hasAttachments = draft.images.length > 0 || draft.files.length > 0;
    if (!text && !hasAttachments) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const attachments: MessageAttachment[] = [
      ...draft.images.map(image => ({
        kind: 'image' as const,
        name: image.name,
        dataUrl: `data:${image.mimeType};base64,${image.data}`,
      })),
      ...draft.files.map(file => ({
        kind: 'file' as const,
        name: file.name,
        // 浏览器里内联的文本附件没有路径，用文件名当展示用的标识
        path: file.path ?? file.name,
      })),
    ];

    const userMsg: PiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
      status: 'done',
    };

    const asstId = `asst-${Date.now()}`;
    handler.setCurrentAssistantId(asstId);

    const assistantMsg: PiMessage = {
      id: asstId,
      role: 'assistant',
      content: '',
      reasoning: '',
      tools: [],
      timestamp: Date.now(),
      status: 'streaming',
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    // 立即置为执行中，确保“停止生成”按钮无需等待 agent_start 事件即出现
    setStatus(prev => ({ ...prev, isStreaming: true }));

    // 正文：文件路径拼进去（文本文件连内容一起内联）；
    // 只有图片时给一句中性的话，避免发出空消息
    const wireText =
      buildPromptWithAttachments(text, draft.files) ||
      (draft.images.length > 0 ? IMAGE_ONLY_INSTRUCTION : '');

    wsRef.current.send(
      JSON.stringify({
        type: 'prompt',
        message: wireText,
        ...(draft.images.length > 0
          ? {
              images: draft.images.map(image => ({
                type: 'image',
                data: image.data,
                mimeType: image.mimeType,
              })),
            }
          : {}),
      })
    );
  }, [handler]);

  const abort = useCallback(() => {
    // 本地立刻收尾（含清掉 currentAssistantId），而不是只改写 isStreaming：
    // 否则停止之后任何一次 get_state 都会把按钮改回「停止生成」
    handler.abortTurn();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'abort' }));
    }
  }, [handler]);

  const changeCwd = useCallback((newCwd: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'change_cwd', cwd: newCwd }));
    }
  }, []);

  const sendCommand = useCallback((command: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));
    }
  }, []);

  const newSession = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      handler.setCurrentAssistantId(null);
      setMessages([]);
      wsRef.current.send(JSON.stringify({ type: 'new_session' }));
    }
  }, [handler]);

  const setModel = useCallback(
    (provider: string, modelId: string) => {
      sendCommand({ type: 'set_model', provider, modelId });
    },
    [sendCommand]
  );

  const setThinkingLevel = useCallback(
    (level: string) => {
      sendCommand({ type: 'set_thinking_level', level });
    },
    [sendCommand]
  );

  const requestSessions = useCallback(() => {
    sendCommand({ type: 'list_sessions' });
  }, [sendCommand]);

  const requestStats = useCallback(() => {
    sendCommand({ type: 'get_session_stats' });
  }, [sendCommand]);

  const switchSession = useCallback(
    (sessionPath: string) => {
      // 点下就进入「切换中」：对话区不再显示上一个会话，历史到达后原地换上
      handler.beginSwitch();
      sendCommand({ type: 'switch_session', sessionPath });
    },
    [handler, sendCommand]
  );

  const renameSession = useCallback(
    (sessionPath: string, name: string) => {
      sendCommand({ type: 'rename_session', sessionPath, name });
    },
    [sendCommand]
  );

  const deleteSession = useCallback(
    (sessionPath: string) => {
      sendCommand({ type: 'trash_session', sessionPath });
    },
    [sendCommand]
  );

  const requestTrash = useCallback(() => {
    sendCommand({ type: 'list_trash' });
  }, [sendCommand]);

  const restoreSession = useCallback(
    (sessionPath: string) => {
      sendCommand({ type: 'restore_session', sessionPath });
    },
    [sendCommand]
  );

  const purgeSession = useCallback(
    (sessionPath: string) => {
      sendCommand({ type: 'purge_session', sessionPath });
    },
    [sendCommand]
  );

  const emptyTrash = useCallback(() => {
    sendCommand({ type: 'empty_trash' });
  }, [sendCommand]);

  return {
    messages,
    status,
    sendPrompt,
    abort,
    changeCwd,
    newSession,
    setModel,
    setThinkingLevel,
    requestSessions,
    requestStats,
    uploadFile,
    listDir,
    readAttachment,
    pickFile,
    switchSession,
    renameSession,
    deleteSession,
    requestTrash,
    restoreSession,
    purgeSession,
    emptyTrash,
  };
}
