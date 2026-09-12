import { MessageParser } from '../utils/messageParser';
import type { PiMessage, ToolCallState } from '../types/pi';

export class RpcEventHandler {
  private currentAssistantId: string | null = null;
  private setMessages: React.Dispatch<React.SetStateAction<PiMessage[]>>;
  private setStatus: React.Dispatch<React.SetStateAction<any>>;

  constructor(
    setMessages: React.Dispatch<React.SetStateAction<PiMessage[]>>,
    setStatus: React.Dispatch<React.SetStateAction<any>>
  ) {
    this.setMessages = setMessages;
    this.setStatus = setStatus;
  }

  public setCurrentAssistantId(id: string | null) {
    this.currentAssistantId = id;
  }

  public handleEvent(data: any, ws: WebSocket) {
    // 1. 桥接服务连接与目录变化
    if (data.type === 'bridge_status' || data.type === 'cwd_changed') {
      this.setStatus((prev: any) => ({ ...prev, cwd: data.cwd }));
      return;
    }

    // 2. RPC 指令响应
    if (data.type === 'response') {
      this.handleResponse(data, ws);
      return;
    }

    // 3. Agent 执行生命周期
    if (data.type === 'agent_start') {
      this.setStatus((prev: any) => ({ ...prev, isStreaming: true }));
      return;
    }

    if (data.type === 'agent_end' || data.type === 'agent_settled') {
      this.setStatus((prev: any) => ({ ...prev, isStreaming: false, currentTool: undefined }));
      if (this.currentAssistantId) {
        const targetId = this.currentAssistantId;
        this.setMessages(prev =>
          prev.map(m => (m.id === targetId ? { ...m, status: 'done' } : m))
        );
        this.currentAssistantId = null;
      }
      return;
    }

    // 4. 流式文本与思考更新
    if (data.type === 'message_update') {
      this.handleMessageUpdate(data);
      return;
    }

    // 5. 工具调用生命周期
    this.handleToolLifecycle(data);
  }

  private handleResponse(data: any, ws: WebSocket) {
    if (data.command === 'get_state' && data.success && data.data) {
      const state = data.data;
      this.setStatus((prev: any) => ({
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
      this.currentAssistantId = null;
      this.setMessages([]);
      ws.send(JSON.stringify({ type: 'get_state' }));
    }

    if (data.command === 'get_messages' && data.success && data.data?.messages) {
      const restored = MessageParser.parseHistory(data.data.messages);
      // 仅在本地尚无对话时用历史填充，避免覆盖进行中的实时消息导致界面跳动
      this.setMessages(prev => (prev.length === 0 ? restored : prev));
    }
  }

  private handleMessageUpdate(data: any) {
    const asstEvt = data.assistantMessageEvent;
    if (!asstEvt || !this.currentAssistantId) return;

    const targetId = this.currentAssistantId;

    if (asstEvt.type === 'thinking_delta') {
      this.setMessages(prev =>
        prev.map(m =>
          m.id === targetId ? { ...m, reasoning: (m.reasoning || '') + asstEvt.delta } : m
        )
      );
    } else if (asstEvt.type === 'text_delta') {
      this.setMessages(prev =>
        prev.map(m =>
          m.id === targetId ? { ...m, content: m.content + asstEvt.delta } : m
        )
      );
    }
  }

  private handleToolLifecycle(data: any) {
    const targetId = this.currentAssistantId;

    if (data.type === 'tool_execution_start') {
      const toolCall: ToolCallState = {
        id: data.toolCallId || `tool-${Date.now()}`,
        name: data.toolName,
        args: data.args,
        status: 'running',
      };

      this.setStatus((prev: any) => ({ ...prev, currentTool: data.toolName }));

      if (targetId) {
        this.setMessages(prev =>
          prev.map(m => {
            if (m.id !== targetId) return m;
            const existing = m.tools || [];
            if (existing.some(t => t.id === toolCall.id)) return m;
            return { ...m, tools: [...existing, toolCall] };
          })
        );
      }
    }

    if (data.type === 'tool_execution_update') {
      if (targetId && data.partialResult) {
        this.setMessages(prev =>
          prev.map(m => {
            if (m.id !== targetId || !m.tools) return m;
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
      this.setStatus((prev: any) => ({ ...prev, currentTool: undefined }));
      if (targetId) {
        this.setMessages(prev =>
          prev.map(m => {
            if (m.id !== targetId || !m.tools) return m;
            return {
              ...m,
              tools: m.tools.map(t => {
                if (t.id !== data.toolCallId) return t;
                const resultData = data.result?.content
                  ? Array.isArray(data.result.content)
                    ? data.result.content.map((c: any) => c.text || '').join('\n')
                    : JSON.stringify(data.result.content)
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
      if (targetId) {
        this.setMessages(prev =>
          prev.map(m => {
            if (m.id !== targetId || !m.tools) return m;
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
  }
}
