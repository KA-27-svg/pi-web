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

  // 专属解耦的 RPC 事件处理器
  const handlerRef = useRef<RpcEventHandler | null>(null);
  if (!handlerRef.current) {
    handlerRef.current = new RpcEventHandler(setMessages, setStatus);
  }

  const requestInitialState = (ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'get_state' }));
      ws.send(JSON.stringify({ type: 'get_messages' }));
    }
  };

  const connectWs = useCallback(() => {
    if (!isMountedRef.current) return;

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) return;
      setStatus(prev => ({ ...prev, connected: true }));
      requestInitialState(ws);
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      setStatus(prev => ({ ...prev, connected: false, isStreaming: false }));
      
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWs();
      }, 2000);
    };

    ws.onerror = (err) => {
      console.error('[usePiWebSocket] Socket error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handlerRef.current?.handleEvent(data, ws);
      } catch (e) {
        console.error('[usePiWebSocket] Failed to process message', e);
      }
    };
  }, []);

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
    handlerRef.current?.setCurrentAssistantId(asstId);

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
  }, []);

  const abort = useCallback(() => {
    // 先本地立即响应，避免按钮状态迟滞
    setStatus(prev => ({ ...prev, isStreaming: false, currentTool: undefined }));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'abort' }));
    }
  }, []);

  const changeCwd = useCallback((newCwd: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'change_cwd', cwd: newCwd }));
    }
  }, []);

  const newSession = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      handlerRef.current?.setCurrentAssistantId(null);
      setMessages([]);
      wsRef.current.send(JSON.stringify({ type: 'new_session' }));
    }
  }, []);

  return {
    messages,
    status,
    sendPrompt,
    abort,
    changeCwd,
    newSession,
  };
}
