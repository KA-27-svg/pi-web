import { useState, useEffect, useRef, useCallback } from 'react';
import type { PiMessage, BridgeStatus } from '../types/pi';
import { RpcEventHandler } from '../services/rpcHandler';
import { readFileAsBase64, type UploadedFile } from '../utils/attachments';

interface PendingUpload {
  resolve: (value: UploadedFile) => void;
  reject: (reason: Error) => void;
  timer: number;
}

const UPLOAD_TIMEOUT_MS = 60_000;

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
   * 等待回包的上传请求。
   * rpcHandler 处理的是「pi 推来的事件」，而上传是「桥接对我这次请求的回答」，
   * 需要按 id 配对，所以放在这里而不是 rpcHandler 里。
   */
  const pendingUploadsRef = useRef(new Map<string, PendingUpload>());

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

  /** 按 id 把桥接的回包交给等待中的 Promise */
  const settleUpload = useCallback((data: any) => {
    const pending = pendingUploadsRef.current.get(data.id);
    if (!pending) return;

    pendingUploadsRef.current.delete(data.id);
    window.clearTimeout(pending.timer);

    if (data.success) {
      pending.resolve({
        path: data.path,
        relativePath: data.relativePath,
        name: data.name,
        bytes: data.bytes,
      });
    } else {
      pending.reject(new Error(data.error ?? '上传失败'));
    }
  }, []);

  /**
   * 把文件交给桥接落到工作目录，拿回相对路径。
   * 浏览器出于安全不会告诉页面文件的本地路径，所以只能把字节传上去——这就是「上传」。
   */
  const uploadFile = useCallback(async (file: File): Promise<UploadedFile> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('未连接到桥接服务');

    const data = await readFileAsBase64(file);

    return new Promise<UploadedFile>((resolve, reject) => {
      const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = window.setTimeout(() => {
        pendingUploadsRef.current.delete(id);
        reject(new Error('上传超时'));
      }, UPLOAD_TIMEOUT_MS);

      pendingUploadsRef.current.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: 'upload_file', id, name: file.name, data }));
    });
  }, []);

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
        if (data.type === 'file_uploaded') {
          settleUpload(data);
          return;
        }
        handler.handleEvent(data, ws);
      } catch (e) {
        console.error('[usePiWebSocket] Failed to process message', e);
      }
    };
  }, [handler, settleUpload]);

  useEffect(() => {
    isMountedRef.current = true;
    connectWs();

    // 捕获这个 Map 本身（引用终身不变），cleanup 里就不必再读 ref.current
    const pendingUploads = pendingUploadsRef.current;

    return () => {
      isMountedRef.current = false;
      clearTimeout(reconnectTimeoutRef.current);
      // 断线时把还在等的上传一并拒掉，否则那些 Promise 会悬在那里
      pendingUploads.forEach(pending => {
        window.clearTimeout(pending.timer);
        pending.reject(new Error('连接已关闭'));
      });
      pendingUploads.clear();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWs]);

  const sendPrompt = useCallback((text: string) => {
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const userMsg: PiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
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

    wsRef.current.send(
      JSON.stringify({
        type: 'prompt',
        message: text.trim(),
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
    switchSession,
    renameSession,
    deleteSession,
    requestTrash,
    restoreSession,
    purgeSession,
    emptyTrash,
  };
}
