import { useState, useEffect, useRef, useCallback } from 'react';
import type { PiMessage, ToolCallState, BridgeStatus } from '../types/pi';

export function usePiWebSocket() {
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [status, setStatus] = useState<BridgeStatus>({
    connected: false,
    cwd: '',
    isStreaming: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus(prev => ({ ...prev, connected: true }));
    };

    ws.onclose = () => {
      setStatus(prev => ({ ...prev, connected: false }));
    };

    ws.onerror = () => {
      setStatus(prev => ({ ...prev, connected: false }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // 桥接状态事件
        if (data.type === 'bridge_status') {
          setStatus(prev => ({ ...prev, cwd: data.cwd }));
          return;
        }

        if (data.type === 'cwd_changed') {
          setStatus(prev => ({ ...prev, cwd: data.cwd }));
          return;
        }

        // Pi RPC 事件流解析
        if (data.type === 'agent_start') {
          setStatus(prev => ({ ...prev, isStreaming: true }));
        }

        if (data.type === 'agent_end' || data.type === 'agent_settled') {
          setStatus(prev => ({ ...prev, isStreaming: false, currentTool: undefined }));
          if (currentAssistantIdRef.current) {
            setMessages(prev =>
              prev.map(m =>
                m.id === currentAssistantIdRef.current
                  ? { ...m, status: 'done' }
                  : m
              )
            );
            currentAssistantIdRef.current = null;
          }
        }

        // 流式消息更新
        if (data.type === 'message_update') {
          const asstEvt = data.assistantMessageEvent;
          if (!asstEvt) return;

          const asstId = currentAssistantIdRef.current;
          if (!asstId) return;

          if (asstEvt.type === 'thinking_delta') {
            setMessages(prev =>
              prev.map(m =>
                m.id === asstId
                  ? { ...m, reasoning: (m.reasoning || '') + asstEvt.delta }
                  : m
              )
            );
          } else if (asstEvt.type === 'text_delta') {
            setMessages(prev =>
              prev.map(m =>
                m.id === asstId
                  ? { ...m, content: m.content + asstEvt.delta }
                  : m
              )
            );
          }
        }

        // 工具调用生命周期映射
        if (data.type === 'tool_execution_start') {
          const toolCall: ToolCallState = {
            id: data.toolCallId || `tool-${Date.now()}`,
            name: data.toolName,
            args: data.args,
            status: 'running',
          };

          setStatus(prev => ({ ...prev, currentTool: data.toolName }));

          const asstId = currentAssistantIdRef.current;
          if (asstId) {
            setMessages(prev =>
              prev.map(m =>
                m.id === asstId
                  ? { ...m, tools: [...(m.tools || []), toolCall] }
                  : m
              )
            );
          }
        }

        if (data.type === 'tool_execution_end') {
          setStatus(prev => ({ ...prev, currentTool: undefined }));
          const asstId = currentAssistantIdRef.current;
          if (asstId) {
            setMessages(prev =>
              prev.map(m => {
                if (m.id !== asstId || !m.tools) return m;
                return {
                  ...m,
                  tools: m.tools.map(t =>
                    t.id === data.toolCallId
                      ? { ...t, status: 'done', result: data.result }
                      : t
                  ),
                };
              })
            );
          }
        }
      } catch (e) {
        console.error('Error handling WebSocket message', e);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  const sendPrompt = useCallback((text: string) => {
    if (!text.trim() || !wsRef.current) return;

    const userMsg: PiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
      status: 'done',
    };

    const asstId = `asst-${Date.now()}`;
    currentAssistantIdRef.current = asstId;

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

    // 下发 RPC prompt 指令
    wsRef.current.send(
      JSON.stringify({
        type: 'prompt',
        message: text.trim(),
      })
    );
  }, []);

  const abort = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'abort' }));
    }
  }, []);

  const changeCwd = useCallback((newCwd: string) => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'change_cwd', cwd: newCwd }));
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    status,
    sendPrompt,
    abort,
    changeCwd,
    clearMessages,
  };
}
