import type { PiMessage, ToolCallState } from '../types/pi';

export class MessageParser {
  /**
   * 将 Pi 官方存储的历史消息 (AgentMessage[]) 解析成可视化 PiMessage[]
   */
  public static parseHistory(rawMessages: any[]): PiMessage[] {
    const restored: PiMessage[] = [];

    for (const rm of rawMessages) {
      if (rm.role === 'user') {
        const userContent = typeof rm.content === 'string'
          ? rm.content
          : Array.isArray(rm.content)
          ? rm.content.map((c: any) => c.text || '').join('\n')
          : '';

        // 屏蔽底层转译给模型的 bash 调试上下文包装
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

    return restored;
  }
}
