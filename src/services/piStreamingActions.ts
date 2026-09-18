import type { MessageAttachment, PiMessage } from '../types/pi';
import {
  IMAGE_ONLY_INSTRUCTION,
  buildPromptWithAttachments,
  type PromptDraft,
} from '../utils/attachments';
import type { PiBridge } from './piBridge';

/**
 * 对话本身：发消息、排队、中断，以及会话内的几个开关（模型 / 思考强度 / 工作目录）。
 */
export function createStreamingActions(bridge: PiBridge) {
  const { setMessages, setStatus, handler, request, sendCommand, isOpen } = bridge;

  /**
   * 取回草稿的序号。
   * 放闭包里而不是每次现算：同一段文本重复取回时，输入框靠 seq 变化才知道这是一次
   * 新的写入，而不是要把用户已经改好的内容盖回去。
   */
  let draftSeq = 0;

  /** 本地立刻收尾，再通知 pi 停 */
  const abort = () => {
    // 本地收尾（含清掉 currentAssistantId），而不是只改写 isStreaming：
    // 否则停止之后任何一次 get_state 都会把按钮改回「停止生成」
    handler.abortTurn();
    sendCommand({ type: 'abort' });
  };

  /**
   * 发一轮对话。
   *
   * 图片走 pi 原生的 `prompt.images`（模型真的「看见」它），文件没有原生通道，
   * 只能把路径写进正文让 agent 自己去读——两条路必须在这里分开，否则图片也会
   * 退化成一行路径。
   *
   * 界面上的 user 消息只存干净的正文 + 结构化 attachments，不存那行路径，
   * 这样气泡里能渲染成图片 / 文件卡片而不是一堆文字。
   */
  const sendPrompt = (draft: PromptDraft, options?: { queue?: boolean }): boolean => {
    const text = draft.text.trim();
    const hasAttachments = draft.images.length > 0 || draft.files.length > 0;
    if (!text && !hasAttachments) return false;
    // 连接断了就别先把气泡加进对话——否则界面上有一条永远等不到回复的消息。
    // 返回 false 让调用方把草稿留着。
    if (!isOpen()) return false;

    const attachments: MessageAttachment[] = [
      ...draft.images.map(image => ({
        kind: 'image' as const,
        name: image.name,
        dataUrl: `data:${image.mimeType};base64,${image.data}`,
      })),
      ...draft.files.map(file => ({
        kind: 'file' as const,
        name: file.name,
        // 浏览器里内联的文本附件没有路径，用文件名当展示用的标识
        path: file.path ?? file.name,
      })),
    ];

    const userMsg: PiMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: Date.now(),
      status: 'done',
    };

    // 正文：文件路径拼进去（文本文件连内容一起内联）；
    // 只有图片时给一句中性的话，避免发出空消息
    const wireText =
      buildPromptWithAttachments(text, draft.files) ||
      (draft.images.length > 0 ? IMAGE_ONLY_INSTRUCTION : '');

    const images =
      draft.images.length > 0
        ? {
            images: draft.images.map(image => ({
              type: 'image',
              data: image.data,
              mimeType: image.mimeType,
            })),
          }
        : {};

    /**
     * 生成中投递只能排队：pi 在没有 streamingBehavior 时会直接拒掉这条 prompt。
     * 本地把消息标成 queued——它还没被回答，中断时要靠这个标记收回去。
     * assistant 占位不在这里建：pi 真正开始这一轮会发 agent_start，占位在那里补。
     */
    if (options?.queue) {
      setMessages(prev => [...prev, { ...userMsg, queued: true }]);
      sendCommand({
        type: 'prompt',
        message: wireText,
        streamingBehavior: 'followUp',
        ...images,
      });
      return true;
    }

    const asstId = `asst-${Date.now()}`;
    handler.setCurrentAssistantId(asstId);

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
    // 立即置为执行中，确保「停止生成」按钮无需等待 agent_start 事件即出现
    setStatus(prev => ({ ...prev, isStreaming: true }));

    sendCommand({ type: 'prompt', message: wireText, ...images });
    return true;
  };

  /**
   * 中断当前这一轮，并把还没被回答的排队消息收回输入栏。
   *
   * 必须先 clear_queue 再 abort：pi 的 abort 会继续投递队列里剩下的消息，
   * 顺序反过来就变成「停下来之后又自己跑起来了」。clear_queue 的回包带
   * steering/followUp 文本，它们正是用户刚打的字，丢掉就等于让他重打一遍。
   */
  const interrupt = async () => {
    let queued: string[] = [];

    try {
      const response = await request<{
        data?: { steering?: unknown; followUp?: unknown };
      }>('clear_queue');

      const collect = (value: unknown) =>
        Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

      queued = [...collect(response?.data?.steering), ...collect(response?.data?.followUp)].filter(
        Boolean
      );
    } catch {
      // 本来就没有队列，或者旧版桥接不认识这条指令——照常打断
    }

    if (queued.length > 0) {
      // 这些消息还没被回答，从对话里收回去，别让它们留在那里等一个不会来的回复
      setMessages(prev => prev.filter(message => !message.queued));
      draftSeq += 1;
      setStatus(prev => ({
        ...prev,
        restoredDraft: { text: queued.join('\n\n'), seq: draftSeq },
      }));
    }

    abort();
  };

  const changeCwd = (newCwd: string) => sendCommand({ type: 'change_cwd', cwd: newCwd });

  const newSession = () => {
    if (!isOpen()) return;
    handler.setCurrentAssistantId(null);
    setMessages([]);
    sendCommand({ type: 'new_session' });
  };

  const setModel = (provider: string, modelId: string) =>
    sendCommand({ type: 'set_model', provider, modelId });

  const setThinkingLevel = (level: string) =>
    sendCommand({ type: 'set_thinking_level', level });

  /** 手动压缩上下文。过程与结果由 compaction_start / compaction_end 事件回报 */
  const compactContext = () => sendCommand({ type: 'compact' });

  return {
    sendPrompt,
    abort,
    interrupt,
    changeCwd,
    newSession,
    setModel,
    setThinkingLevel,
    compactContext,
  };
}
