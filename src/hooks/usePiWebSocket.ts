import { useState, useEffect, useRef, useCallback } from 'react';
import type { PiMessage, BridgeStatus } from '../types/pi';
import { RpcEventHandler } from '../services/rpcHandler';

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

  // 专属解耦的 RPC 事件处理器：惰性初始化一次即可。用 useState 而不是渲染期间写 ref，
  // setMessages/setStatus 来自 useState，引用是稳定的，所以处理器只需构造一次。
  const [handler] = useState(() => new RpcEventHandler(setMessages, setStatus));

  const requestInitialState = (ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'get_state' }));
      ws.send(JSON.stringify({ type: 'get_messages' }));
      ws.send(JSON.stringify({ type: 'get_available_models' }));
      ws.send(JSON.stringify({ type: 'get_available_thinking_levels' }));
      // 连接建立后再拉历史会话，否则首屏调用时连接尚未就绪
      ws.send(JSON.stringify({ type: 'list_sessions' }));
    }
  };

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
        handler.handleEvent(data, ws);
      } catch (e) {
        console.error('[usePiWebSocket] Failed to process message', e);
      }
    };
  }, [handler]);

  useEffect(() => {
    isMountedRef.current = true;
    connectWs();

    return () => {
      isMountedRef.current = false;
      clearTimeout(reconnectTimeoutRef.current);
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
    switchSession,
    renameSession,
    deleteSession,
    requestTrash,
    restoreSession,
    purgeSession,
    emptyTrash,
  };
}
