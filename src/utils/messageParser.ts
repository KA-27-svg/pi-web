import type { PiMessage, ToolCallState } from '../types/pi';

export class MessageParser {
  /**
   * 将 Pi 官方存储的历史消息 (AgentMessage[]) 解析为可视化 PiMessage[]
   *
   * 两条约定：
   *  - 标记 `fromHistory`：这批消息不是刚刚产生的，不该播入场动画。
   *    切换会话与重连都会走这里，播动画会看起来像整段对话被重新加载。
   *  - 每次加载用一批新 id：不同会话之间不应共用组件状态，
   *    否则同一个下标上的思考块展开状态会从一个会话串到另一个会话。
   *    动画已由 fromHistory 抑制，所以不再需要靠 id 稳定来防重播。
   */
  public static parseHistory(rawMessages: any[]): PiMessage[] {
    const restored: PiMessage[] = [];
    const loadId = Math.random().toString(36).slice(2, 8);

    rawMessages.forEach((rm, index) => {
      const id = (kind: string) => `hist-${loadId}-${kind}-${index}`;

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
          id: id('user'),
          role: 'user',
          content: userContent,
          timestamp: rm.timestamp || 0,
          status: 'done',
          fromHistory: true,
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
                // pi 存储的是 arguments；input/args 是兼容其他消息格式的兜底
                args: block.arguments ?? block.input ?? block.args ?? {},
                status: 'done',
              });
            }
          }
        } else if (typeof rm.content === 'string') {
          content = rm.content;
        }

        restored.push({
          id: id('asst'),
          role: 'assistant',
          content,
          reasoning,
          tools: tools.length > 0 ? tools : undefined,
          timestamp: rm.timestamp || 0,
          status: 'done',
          fromHistory: true,
        });
      }
    });

    return restored;
  }
}
