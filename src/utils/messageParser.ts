import type { PiMessage, ToolCallState, MessageAttachment } from '../types/pi';
import { IMAGE_ONLY_INSTRUCTION, baseName, parseFileAttachments } from './attachments';

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
    // 工具输出在 pi 的历史里是独立的 toolResult 消息，按 toolCallId 挂回对应的工具；
    // 不接住的话，刷新 / 切会话后工具卡片展开就是空的
    const toolsById = new Map<string, ToolCallState>();
    /** 当前回合正在累加的那条 assistant 消息；遇到 user 就断开 */
    let currentAssistant: PiMessage | null = null;

    const toolResultText = (content: unknown): string =>
      Array.isArray(content)
        ? content
            .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
            .join('\n')
        : typeof content === 'string'
          ? content
          : '';

    rawMessages.forEach((rm, index) => {
      const id = (kind: string) => `hist-${loadId}-${kind}-${index}`;

      if (rm.role === 'toolResult') {
        const tool =
          typeof rm.toolCallId === 'string' ? toolsById.get(rm.toolCallId) : undefined;
        if (tool) {
          tool.result = toolResultText(rm.content);
          if (rm.isError) tool.status = 'error';
        }
        return;
      }

      // 自动压缩留下的摘要。压掉的那段正文确实没了（模型也看不到了），
      // 但这一条得留在原位：不画的话用户只会看到「上面的对话不见了」。
      if (rm.role === 'compactionSummary') {
        currentAssistant = null;
        restored.push({
          id: id('compaction'),
          role: 'compaction',
          content: typeof rm.summary === 'string' ? rm.summary : '',
          tokensBefore: typeof rm.tokensBefore === 'number' ? rm.tokensBefore : undefined,
          timestamp: rm.timestamp || 0,
          status: 'done',
          fromHistory: true,
        });
        return;
      }

      if (rm.role === 'user') {
        // 新回合开始，后面连着来的 assistant 不该再并进上一条
        currentAssistant = null;
        const blocks = Array.isArray(rm.content) ? rm.content : null;
        const rawText = blocks
          ? blocks
              .filter((c: any) => c?.type === 'text')
              .map((c: any) => c.text || '')
              .join('\n')
          : typeof rm.content === 'string'
            ? rm.content
            : '';

        // 屏蔽底层转译给模型的 bash 调试上下文包装
        if (rawText.startsWith('Ran `') && rawText.includes('```')) {
          return;
        }

        // 图片以 ImageContent 形式存在会话里（没有文件名），需要重新拼成 data URL
        const images: MessageAttachment[] = (blocks ?? [])
          .filter((b: any) => b?.type === 'image' && typeof b.data === 'string')
          .map((b: any, imageIndex: number) => ({
            kind: 'image' as const,
            name: `图片 ${imageIndex + 1}`,
            dataUrl: `data:${b.mimeType || 'image/png'};base64,${b.data}`,
          }));

        // 文件在会话里只是一行 `[附件] 路径` 文本，所以展示时反过来解析一遍
        const { text, paths } = parseFileAttachments(rawText);
        const files: MessageAttachment[] = paths.map(p => ({
          kind: 'file' as const,
          name: baseName(p),
          path: p,
        }));

        const attachments = [...images, ...files];
        // 图片可以在没有正文的情况下单独发出，那句占位提示不该显示在气泡里
        const displayText =
          images.length > 0 && text === IMAGE_ONLY_INSTRUCTION ? '' : text;

        restored.push({
          id: id('user'),
          role: 'user',
          content: displayText,
          attachments: attachments.length > 0 ? attachments : undefined,
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
              const tool: ToolCallState = {
                id: block.id || `hist-tool-${index}-${tools.length}`,
                name: block.name || block.toolName || 'tool',
                // pi 存储的是 arguments；input/args 是兼容其他消息格式的兜底
                args: block.arguments ?? block.input ?? block.args ?? {},
                status: 'done',
              };
              tools.push(tool);
              toolsById.set(tool.id, tool);
            }
          }
        } else if (typeof rm.content === 'string') {
          content = rm.content;
        }

        // pi 是「一次 LLM 响应 = 一条 assistant 消息」：同一回合里连着来的要并成
        // 一条（实时视图本来就是这样），否则刷新后整轮会被拆成一堆「N 步操作」。
        if (!currentAssistant) {
          currentAssistant = {
            id: id('asst'),
            role: 'assistant',
            content: '',
            reasoning: '',
            timestamp: rm.timestamp || 0,
            status: 'done',
            fromHistory: true,
          };
          restored.push(currentAssistant);
        }

        const target = currentAssistant;
        if (reasoning) {
          target.reasoning = target.reasoning
            ? `${target.reasoning}\n\n${reasoning}`
            : reasoning;
        }
        if (content) {
          target.content = target.content ? `${target.content}\n\n${content}` : content;
        }
        if (tools.length > 0) {
          target.tools = [...(target.tools ?? []), ...tools];
        }
        // pi 的 assistant 消息带 model，历史里就靠它知道这条是谁答的。
        // 合并后取最后一次（真正作答的那次）的 model 与时间
        if (typeof rm.model === 'string' && rm.model) target.model = rm.model;
        if (rm.timestamp) target.timestamp = rm.timestamp;
      }
    });

    // 没有工具的就不要挂一个空数组（保持输出形状干净）
    for (const message of restored) {
      if (message.role === 'assistant' && message.tools && message.tools.length === 0) {
        delete message.tools;
      }
    }

    return restored;
  }
}
