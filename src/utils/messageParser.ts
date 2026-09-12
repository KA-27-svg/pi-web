import type { PiMessage, ToolCallState } from '../types/pi';

export class MessageParser {
  /**
   * 将 Pi 官方存储的历史消息 (AgentMessage[]) 解析为可视化 PiMessage[]
   *
   * 关键：ID 必须稳定（基于索引派生），否则每次 get_messages 都会让
   * React 认为消息是全新的，导致整段对话重新挂载并重播入场动画（抽搐）。
   */
  public static parseHistory(rawMessages: any[]): PiMessage[] {
    const restored: PiMessage[] = [];

    rawMessages.forEach((rm, index) => {
      const stableId = (kind: string) => `hist-${kind}-${index}`;

      if (rm.role === 'user') {
        const userContent = typeof rm.content === 'string'
          ? rm.content
          : Array.isArray(rm.content)
          ? rm.content.map((c: any) => c.text || '').join('\n')
          : '';

        // 屏蔽底层转译给模型的 bash 调试上下文包装
        if (userContent.startsWith('Ran `') && userContent.includes('```')) {
          return;
        }

        restored.push({
          id: stableId('user'),
          role: 'user',
          content: userContent,
          timestamp: rm.timestamp || 0,
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
                id: block.id || `hist-tool-${index}-${tools.length}`,
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
          id: stableId('asst'),
          role: 'assistant',
          content,
          reasoning,
          tools: tools.length > 0 ? tools : undefined,
          timestamp: rm.timestamp || 0,
          status: 'done',
        });
      }
    });

    return restored;
  }
}
