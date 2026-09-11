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
  const reconnectTimeoutRef = useRef<any>(null);
  const isMountedRef = useRef(true);

  // 指向当前正在接收流的 Assistant Message ID
  const currentAssistantIdRef = useRef<string | null>(null);

  const requestInitialState = (ws: WebSocket) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'get_state' }));
      ws.send(JSON.stringify({ type: 'get_messages' }));
    }
  };

  const connectWs = useCallback(() => {
    if (!isMountedRef.current) return;

    // 清理之前的连接与定时器
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
      console.log('[usePiWebSocket] Connected to bridge');
      setStatus(prev => ({ ...prev, connected: true }));
      requestInitialState(ws);
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      console.warn('[usePiWebSocket] Disconnected from bridge. Reconnecting in 2s...');
      setStatus(prev => ({ ...prev, connected: false, isStreaming: false }));
      
      // 2秒后自动尝试退避重连
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWs();
      }, 2000);
    };

    ws.onerror = (err) => {
      console.error('[usePiWebSocket] Socket error:', err);
      // onerror 会触发 onclose，由 onclose 统一进行重连处理
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // 1. 桥接服务状态通知
        if (data.type === 'bridge_status' || data.type === 'cwd_changed') {
          setStatus(prev => ({ ...prev, cwd: data.cwd }));
          return;
        }

        // 2. 处理 RPC 命令响应 (get_state / get_messages)
        if (data.type === 'response') {
          if (data.command === 'get_state' && data.success && data.data) {
            const state = data.data;
            setStatus(prev => ({
              ...prev,
              thinkingLevel: state.thinkingLevel,
              sessionId: state.sessionId,
              model: state.model
                ? {
                    id: state.model.id,
                    name: state.model.name,
                    provider: state.model.provider,
                    contextWindow: state.model.contextWindow,
                  }
                : undefined,
            }));
          }

          if (data.command === 'new_session' && data.success) {
            // 后端新建会话成功，立即清空本地消息并刷新状态
            currentAssistantIdRef.current = null;
            setMessages([]);
            ws.send(JSON.stringify({ type: 'get_state' }));
            return;
          }

          if (data.command === 'get_messages' && data.success && data.data?.messages) {
            const rawMessages: any[] = data.data.messages;
            const restored: PiMessage[] = [];

            for (const rm of rawMessages) {
              if (rm.role === 'user') {
                const userContent = typeof rm.content === 'string'
                  ? rm.content
                  : Array.isArray(rm.content)
                  ? rm.content.map((c: any) => c.text || '').join('\n')
                  : '';
                
                if (userContent.startsWith('Ran `') && userContent.includes('```')) {
                  continue;
                }

                restored.push({
                  id: rm.id || `user-${Date.now()}-${Math.random()}`,
                  role: 'user',
                  content: userContent,
                  timestamp: rm.timestamp || Date.now(),
                  status: 'done',
                });
              } else if (rm.role === 'assistant') {
                let content = '';
                let reasoning = '';
                const tools: ToolCallState[] = [];

                if (Array.isArray(rm.content)) {
                  for (const block of rm.content) {
                    if (block.type === 'text') content += block.text || '';
                    if (block.type === 'thinking') reasoning += block.thinking || '';
                    if (block.type === 'tool_use' || block.type === 'toolCall') {
                      tools.push({
                        id: block.id || `tool-${Date.now()}`,
                        name: block.name || block.toolName || 'tool',
                        args: block.input || block.args || {},
                        status: 'done',
                      });
                    }
                  }
                } else if (typeof rm.content === 'string') {
                  content = rm.content;
                }

                restored.push({
                  id: rm.id || `asst-${Date.now()}-${Math.random()}`,
                  role: 'assistant',
                  content,
                  reasoning,
                  tools: tools.length > 0 ? tools : undefined,
                  timestamp: rm.timestamp || Date.now(),
                  status: 'done',
                });
              }
            }

            setMessages(restored);
          }
          return;
        }

        // 3. Pi Agent 全局运行生命周期
        if (data.type === 'agent_start') {
          setStatus(prev => ({ ...prev, isStreaming: true }));
        }

        // 4. 多轮转折处理 (Turn 管理)
        // 当一个 turn 结束并包含工具调用时，如果接下来有新的 turn，确保消息结构平滑追加而不相互覆盖
        if (data.type === 'turn_start') {
          // 如果当前已有 assistant 消息，且上一个 turn 已经有工具调用或正文，保持追加通道畅通
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

        // 5. 流式文本与思考链更新 (message_update)
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

        // 6. 工具调用全生命周期 (tool_execution_start / update / end / turn_end)
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
              prev.map(m => {
                if (m.id !== asstId) return m;
                const existing = m.tools || [];
                if (existing.some(t => t.id === toolCall.id)) return m;
                return { ...m, tools: [...existing, toolCall] };
              })
            );
          }
        }

        if (data.type === 'tool_execution_update') {
          const asstId = currentAssistantIdRef.current;
          if (asstId && data.partialResult) {
            setMessages(prev =>
              prev.map(m => {
                if (m.id !== asstId || !m.tools) return m;
                return {
                  ...m,
                  tools: m.tools.map(t => {
                    if (t.id !== data.toolCallId) return t;
                    const textContent = Array.isArray(data.partialResult?.content)
                      ? data.partialResult.content.map((c: any) => c.text || '').join('\n')
                      : data.partialResult;
                    return { ...t, result: textContent };
                  }),
                };
              })
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
                  tools: m.tools.map(t => {
                    if (t.id !== data.toolCallId) return t;
                    const resultData = data.result?.content
                      ? (Array.isArray(data.result.content)
                          ? data.result.content.map((c: any) => c.text || '').join('\n')
                          : JSON.stringify(data.result.content))
                      : data.result;
                    return {
                      ...t,
                      status: 'done',
                      result: resultData ?? t.result,
                    };
                  }),
                };
              })
            );
          }
        }

        if (data.type === 'turn_end' && Array.isArray(data.toolResults)) {
          const asstId = currentAssistantIdRef.current;
          if (asstId) {
            setMessages(prev =>
              prev.map(m => {
                if (m.id !== asstId || !m.tools) return m;
                return {
                  ...m,
                  tools: m.tools.map(t => {
                    const matched = data.toolResults.find((r: any) => r.toolCallId === t.id);
                    if (matched) {
                      const resText = Array.isArray(matched.content)
                        ? matched.content.map((c: any) => c.text || '').join('\n')
                        : matched.content;
                      return { ...t, status: 'done', result: resText || t.result };
                    }
                    return t;
                  }),
                };
              })
            );
          }
        }
      } catch (e) {
        console.error('Error handling WebSocket message', e);
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

    wsRef.current.send(
      JSON.stringify({
        type: 'prompt',
        message: text.trim(),
      })
    );
  }, []);

  const abort = useCallback(() => {
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
      currentAssistantIdRef.current = null;
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
