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

  const requestInitialState = useCallback((ws: WebSocket) => {
    // 请求会话状态与模型信息
    ws.send(JSON.stringify({ type: 'get_state' }));
    // 请求当前会话的所有历史消息
    ws.send(JSON.stringify({ type: 'get_messages' }));
  }, []);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001');
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus(prev => ({ ...prev, connected: true }));
      requestInitialState(ws);
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

        // 1. 桥接状态
        if (data.type === 'bridge_status' || data.type === 'cwd_changed') {
          setStatus(prev => ({ ...prev, cwd: data.cwd }));
          return;
        }

        // 2. 处理 RPC 响应指令 (get_state / get_messages)
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

          if (data.command === 'get_messages' && data.success && data.data?.messages) {
            // 将 Pi 本地存储的 AgentMessage 数组映射为前端 PiMessage
            const rawMessages: any[] = data.data.messages;
            const restored: PiMessage[] = [];

            for (const rm of rawMessages) {
              if (rm.role === 'user') {
                const userContent = typeof rm.content === 'string'
                  ? rm.content
                  : Array.isArray(rm.content)
                  ? rm.content.map((c: any) => c.text || '').join('\n')
                  : '';
                
                // 忽略底层包装的 bash 执行结果提示
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

            if (restored.length > 0) {
              setMessages(restored);
            }
          }
          return;
        }

        // 3. Pi RPC 事件流 - 运行状态
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

        // 4. 流式消息增量 (message_update)
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

        // 5. 工具调用生命周期与执行结果回显 (tool_execution_start / tool_execution_end / turn_end)
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
                const existingTools = m.tools || [];
                const alreadyExists = existingTools.some(t => t.id === toolCall.id);
                if (alreadyExists) return m;
                return { ...m, tools: [...existingTools, toolCall] };
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

        // turn_end 携带批量 toolResults，做最终兜底填充
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

    return () => {
      ws.close();
    };
  }, [requestInitialState]);

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

  const newSession = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'new_session' }));
      setMessages([]);
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
