import { MessageParser } from '../utils/messageParser';
import type { PiMessage, ToolCallState, ModelInfo } from '../types/pi';

function toModelInfo(model: any): ModelInfo | undefined {
  if (!model) return undefined;
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    contextWindow: model.contextWindow,
  };
}

export class RpcEventHandler {
  private currentAssistantId: string | null = null;
  /** 刚发出 switch_session，下一次 get_messages 要直接替换而不是「仅在本空时填充」 */
  private pendingHistory = false;
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

  /** 结束当前这一轮：复位执行状态，并把占位消息落定为完成或失败 */
  private finishTurn(error?: string) {
    this.setStatus((prev: any) => ({ ...prev, isStreaming: false, currentTool: undefined }));

    const targetId = this.currentAssistantId;
    if (!targetId) return;

    this.setMessages(prev =>
      prev.map(m =>
        m.id === targetId ? { ...m, status: error ? 'error' : 'done', error } : m
      )
    );
    this.currentAssistantId = null;
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

    // agent_end 只代表一次底层 run 结束，后面还可能跟着自动重试、压缩重跑或排队消息，
    // 只有 agent_settled 才是整轮真正收尾。在 agent_end 就收尾会让“停止生成”
    // 按钮在重试期间闪一下又变回来，消息也会被提前标成完成。
    if (data.type === 'agent_end') return;

    if (data.type === 'agent_settled') {
      this.finishTurn();
      return;
    }

    // pi 进程崩溃或桥接报错：本地必须收尾，否则输入框会一直停在“生成中”
    if (
      data.type === 'pi_process_exit' ||
      data.type === 'pi_process_error' ||
      data.type === 'bridge_error'
    ) {
      console.error('[Pi]', data.error ?? data.type);
      this.finishTurn(
        data.error || `Pi 进程已退出（code ${data.code ?? '未知'}）`
      );
      return;
    }

    // 4. 流式文本与思考更新
    if (data.type === 'message_update') {
      this.handleMessageUpdate(data);
      return;
    }

    // 5. 桥接扫描会话目录的结果
    if (data.type === 'sessions_list') {
      this.setStatus((prev: any) => ({
        ...prev,
        sessions: data.sessions ?? [],
        sessionsTotal:
          typeof data.total === 'number' ? data.total : (data.sessions ?? []).length,
      }));
      return;
    }

    if (data.type === 'trash_list') {
      this.setStatus((prev: any) => ({ ...prev, trashed: data.sessions ?? [] }));
      return;
    }

    // 6. 会话增删改的结果。失败必须说出来，不能点了没反应。
    if (
      data.type === 'session_renamed' ||
      data.type === 'session_trashed' ||
      data.type === 'session_restored' ||
      data.type === 'session_purged' ||
      data.type === 'trash_emptied'
    ) {
      if (!data.success) {
        this.setStatus((prev: any) => ({ ...prev, notice: data.error ?? '操作失败' }));
        return;
      }

      // 两个列表都可能变了：会话列表多/少一条，回收箱少/多一条
      ws.send(JSON.stringify({ type: 'list_sessions' }));
      if (data.type !== 'session_renamed') {
        ws.send(JSON.stringify({ type: 'list_trash' }));
      }
      return;
    }

    // 7. 工具调用生命周期
    this.handleToolLifecycle(data);
  }

  private handleResponse(data: any, ws: WebSocket) {
    if (data.command === 'get_state' && data.success && data.data) {
      const state = data.data;
      this.setStatus((prev: any) => ({
        ...prev,
        thinkingLevel: state.thinkingLevel,
        sessionId: state.sessionId,
        model: toModelInfo(state.model),
        // 本地已经有一条在生成的回复时，不让回包把状态改回“已停止”
        isStreaming: this.currentAssistantId ? true : !!state.isStreaming,
      }));
    }

    if (
      data.command === 'get_available_models' &&
      data.success &&
      Array.isArray(data.data?.models)
    ) {
      this.setStatus((prev: any) => ({
        ...prev,
        availableModels: data.data.models.map(toModelInfo).filter(Boolean),
      }));
    }

    if (
      data.command === 'get_available_thinking_levels' &&
      data.success &&
      Array.isArray(data.data?.levels)
    ) {
      this.setStatus((prev: any) => ({
        ...prev,
        availableThinkingLevels: data.data.levels,
      }));
    }

    // 切换模型后，agent 会重新解析该模型支持的思考档位，因此一并刷新
    if (data.command === 'set_model' && data.success) {
      const model = toModelInfo(data.data?.model ?? data.data);
      if (model) {
        this.setStatus((prev: any) => ({ ...prev, model }));
      }
      ws.send(JSON.stringify({ type: 'get_available_thinking_levels' }));
      ws.send(JSON.stringify({ type: 'get_state' }));
    }

    // 档位可能被模型能力收窄（clamp），以 get_state 的结果为准
    if (data.command === 'set_thinking_level' && data.success) {
      ws.send(JSON.stringify({ type: 'get_state' }));
    }

    if (data.command === 'new_session' && data.success) {
      this.currentAssistantId = null;
      this.pendingHistory = false;
      this.setMessages([]);
      ws.send(JSON.stringify({ type: 'get_state' }));
    }

    // 切换历史会话：重新拉取该会话的消息。
    // 这里不清空现有消息：中间会多出一帧空对话，那一帧会让底部输入区的位置与
    // 滚动位置先弹一次，而且消息节点全被卸载重建会重播入场动画。
    if (data.command === 'switch_session') {
      if (data.success && !data.data?.cancelled) {
        this.currentAssistantId = null;
        this.pendingHistory = true;
        ws.send(JSON.stringify({ type: 'get_messages' }));
        ws.send(JSON.stringify({ type: 'get_state' }));
        this.setStatus((prev: any) => ({ ...prev, notice: undefined }));
        return;
      }

      // 会话记录里的项目目录被删掉时 pi 会直接拒绝，以前这里是静默的
      this.setStatus((prev: any) => ({
        ...prev,
        notice: data.success
          ? '该会话切换被扩展取消'
          : `无法打开该会话：${data.error ?? '未知原因'}`,
      }));
      return;
    }

    // 重命名当前会话后，列表里的名字需要刷新
    if (data.command === 'set_session_name' && data.success) {
      ws.send(JSON.stringify({ type: 'list_sessions' }));
    }

    if (data.command === 'get_messages' && data.success && data.data?.messages) {
      const restored = MessageParser.parseHistory(data.data.messages);

      // 刚切换过会话：这份历史就是要替换掉旧会话的内容
      if (this.pendingHistory) {
        this.pendingHistory = false;
        this.setMessages(restored);
        return;
      }

      // 其余情况（重连后补拉）仅在本地尚无对话时填充，
      // 避免覆盖进行中的实时消息导致界面跳动
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
