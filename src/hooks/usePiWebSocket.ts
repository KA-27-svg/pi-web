import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { BridgeStatus, PiMessage } from '../types/pi';
import { RpcEventHandler } from '../services/rpcHandler';
import type { PiBridge } from '../services/piBridge';
import { createStreamingActions } from '../services/piStreamingActions';
import { createSessionActions } from '../services/piSessionActions';
import { createAttachmentActions } from '../services/piAttachmentActions';
import { createSetupActions } from '../services/piSetupActions';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: number;
}

/** 桥接请求（上传 / 列目录）的超时；超过了就当作失败，不让界面一直等 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * 和桥接的连接，外加三个领域的动作。
 *
 * 这里只做三件事：连上桥接、把 pi 推来的事件交给 RpcEventHandler 翻译、
 * 把动作模块组装起来返回。动作本身在 services/pi*Actions.ts 里各自独立——
 * 以前全挤在这一个文件里，改附件会碰到会话管理。
 */
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
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'get_state' }));
    ws.send(JSON.stringify({ type: 'get_messages' }));
    ws.send(JSON.stringify({ type: 'get_available_models' }));
    ws.send(JSON.stringify({ type: 'get_available_thinking_levels' }));
    ws.send(JSON.stringify({ type: 'get_session_stats' }));
    // 环境探测：未就绪时界面要进向导，不能等用户发完消息才发现没回复
    ws.send(JSON.stringify({ type: 'get_setup_status' }));
    // 连接建立后再拉历史会话，否则首屏调用时连接尚未就绪
    ws.send(JSON.stringify({ type: 'list_sessions' }));
  };

  /**
   * 按 id 把回包交给等待中的 Promise；不是我们的就返回 false，交给 rpcHandler。
   *
   * **不看 type**：桥接不认识某条指令时（比如忘记重启，跑的还是旧代码），它会把
   * 指令原样转发给 pi，pi 回一条 `{type:'response', error:'Unknown command: xxx'}`。
   * 如果按 type 匹配，这条回包就配不上号，界面会干等到 60 秒超时——而真正的原因
   * （指令不认识）其实就在包里。按 id 匹配就能立刻失败并把它显示出来。
   */
  const settleRequest = useCallback((data: any): boolean => {
    const pending =
      typeof data?.id === 'string' ? pendingRequestsRef.current.get(data.id) : undefined;
    if (!pending) return false;

    pendingRequestsRef.current.delete(data.id);
    window.clearTimeout(pending.timer);

    if (data.success === false || typeof data.error === 'string') {
      pending.reject(new Error(data.error ?? '桥接操作失败'));
    } else {
      pending.resolve(data);
    }
    return true;
  }, []);

  /** 发一条桥接指令并等它的回包（按 id 配对，不看类型） */
  const request = useCallback(
    <T,>(type: string, payload: Record<string, unknown> = {}): Promise<T> => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('未连接到桥接服务'));
      }

      return new Promise<T>((resolve, reject) => {
        const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timer = window.setTimeout(() => {
          pendingRequestsRef.current.delete(id);
          reject(new Error('桥接没有响应（超时）。旧版本可能不认识这条指令，试试重启桥接。'));
        }, REQUEST_TIMEOUT_MS);

        pendingRequestsRef.current.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ type, id, ...payload }));
      });
    },
    []
  );

  const isOpen = useCallback(() => {
    const ws = wsRef.current;
    return !!ws && ws.readyState === WebSocket.OPEN;
  }, []);

  const sendCommand = useCallback((command: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(command));
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

  // 连接上下文。字段都是稳定的，所以下面三个动作模块只会构造一次，
  // 它们返回的函数引用也就稳定，不会让下游白白重渲染。
  const bridge = useMemo<PiBridge>(
    () => ({ setMessages, setStatus, handler, request, sendCommand, isOpen }),
    [handler, request, sendCommand, isOpen]
  );

  /**
   * 四个领域的动作。
   *
   * oxlint 会在下面报「渲染期访问 ref」，是误报：create*Actions 只是把访问 ref 的
   * 函数装进返回对象，真正读 ref 发生在用户点击之后。bridge 的字段都是稳定的，
   * 所以这四块只会构造一次。
   */
  /* oxlint-disable react/refs */
  const actions = useMemo(
    () => ({
      ...createStreamingActions(bridge),
      ...createSessionActions(bridge),
      ...createAttachmentActions(bridge),
      ...createSetupActions(bridge),
    }),
    [bridge]
  );
  /* oxlint-enable react/refs */

  return {
    messages,
    status,
    ...actions,
  };
}
